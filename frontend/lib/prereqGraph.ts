/**
 * Prerequisite graph over the course catalog.
 *
 * Vertices are courses ("MAT 167"); a directed edge prereq -> course means
 * the prereq is needed first. Each course's requirements are AND-of-OR
 * groups: every group is required, any one course in a group satisfies it.
 *
 * Kept free of app imports so it can be unit tested with plain Node.
 */

export type PrereqCourse = {
  subject: string;
  catalog_nbr: string;
  title: string;
  prereqs?: string[][];
  coreqs?: string[][];
  requirement?: string;
};

export type GraphNode = {
  code: string;
  title: string;
  /** false when a prerequisite isn't in our catalog (we only know its code) */
  known: boolean;
  requirement?: string;
};

export type GraphEdge = {
  from: string; // prerequisite
  to: string; // course that needs it
  /** true when this prereq is one of several alternatives ("one of") */
  alternative: boolean;
};

export type Layout = {
  /**
   * columns[0] = foundations ... columns[last] = the target course. Ids
   * starting with "~" are waypoints for arrows that skip columns.
   */
  columns: string[][];
  /** waypoint ids each long edge threads through, keyed by edgeKey() */
  routes: Map<string, string[]>;
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  /** edges dropped because they would close a cycle in the catalog data */
  cycles: GraphEdge[];
};

export class PrereqGraph {
  private courses = new Map<string, PrereqCourse>();
  /** reverse adjacency: course -> courses that list it as a prerequisite */
  private dependents = new Map<string, Set<string>>();

  constructor(courses: PrereqCourse[]) {
    for (const c of courses) this.courses.set(codeOf(c), c);
    for (const [code, c] of this.courses) {
      for (const group of c.prereqs ?? []) {
        for (const p of group) {
          let set = this.dependents.get(p);
          if (!set) this.dependents.set(p, (set = new Set()));
          set.add(code);
        }
      }
    }
  }

  has(code: string) {
    return this.courses.has(code);
  }

  /** Every course in the catalog. */
  all(): PrereqCourse[] {
    return [...this.courses.values()];
  }

  /** Courses that have any prerequisite data, for pickers and tests. */
  withPrereqs(): string[] {
    return [...this.courses.values()].filter((c) => c.prereqs?.length).map(codeOf);
  }

  node(code: string): GraphNode {
    const c = this.courses.get(code);
    return c
      ? { code, title: c.title, known: true, requirement: c.requirement }
      : { code, title: "", known: false };
  }

  groups(code: string): string[][] {
    return this.courses.get(code)?.prereqs ?? [];
  }

  /** Courses to take alongside `code`, as AND-of-OR groups. */
  coreqs(code: string): string[][] {
    return this.courses.get(code)?.coreqs ?? [];
  }

  /** Courses whose requirements mention `code` directly. */
  unlocks(code: string): string[] {
    return [...(this.dependents.get(code) ?? [])].sort(compareCodes);
  }

  /** Everything `code` eventually unlocks: BFS over reverse edges. */
  unlocksAll(code: string): string[] {
    const seen = new Set<string>([code]);
    const queue = [code];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of this.dependents.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    seen.delete(code);
    return [...seen].sort(compareCodes);
  }

  /**
   * The full requirement tree under `target`, laid out in columns.
   *
   * 1. DFS from the target with white/gray/black marking; an edge into a
   *    gray (on-stack) vertex would close a cycle, so it is set aside.
   * 2. Longest-path layering: in topological order (Kahn's algorithm over
   *    course -> prereq edges) each prereq lands one column past the
   *    deepest course that needs it, so every arrow points rightward.
   * 3. Long edges get a waypoint in every column they skip (as in
   *    Sugiyama-style drawing), so arrows run through gaps, not courses.
   * 4. Barycenter ordering: each column is sorted by the mean position of
   *    its neighbours in the previous column, which untangles arrows.
   */
  layout(target: string, maxDepth = 10): Layout {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const cycles: GraphEdge[] = [];
    const color = new Map<string, "gray" | "black">();

    const visit = (code: string, depth: number) => {
      color.set(code, "gray");
      nodes.set(code, this.node(code));
      if (depth < maxDepth) {
        for (const group of this.groups(code)) {
          for (const p of group) {
            const edge = { from: p, to: code, alternative: group.length > 1 };
            const c = color.get(p);
            if (c === "gray") {
              cycles.push(edge);
              continue;
            }
            edges.push(edge);
            if (!c) visit(p, depth + 1);
          }
        }
      }
      color.set(code, "black");
    };
    visit(target, 0);

    // longest path from the target, via Kahn's topological order
    const needs = new Map<string, string[]>(); // course -> its prereqs (DAG edges)
    const indegree = new Map<string, number>([...nodes.keys()].map((k) => [k, 0]));
    for (const e of edges) {
      needs.set(e.to, [...(needs.get(e.to) ?? []), e.from]);
      indegree.set(e.from, (indegree.get(e.from) ?? 0) + 1);
    }
    const depth = new Map<string, number>([[target, 0]]);
    const queue = [...nodes.keys()].filter((k) => indegree.get(k) === 0);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const p of needs.get(cur) ?? []) {
        depth.set(p, Math.max(depth.get(p) ?? 0, (depth.get(cur) ?? 0) + 1));
        indegree.set(p, indegree.get(p)! - 1);
        if (indegree.get(p) === 0) queue.push(p);
      }
    }

    const maxD = Math.max(0, ...depth.values());
    const columns: string[][] = Array.from({ length: maxD + 1 }, () => []);
    const colOf = new Map<string, number>();
    for (const [code, d] of depth) {
      columns[maxD - d].push(code);
      colOf.set(code, maxD - d);
    }
    for (const col of columns) col.sort(compareCodes);

    // waypoints for edges that skip columns; the ordering sees the segments
    const routes = new Map<string, string[]>();
    const neighbours = new Map<string, string[]>();
    const link = (a: string, b: string) => {
      neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
      neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
    };
    for (const e of edges) {
      const a = colOf.get(e.from)!;
      const b = colOf.get(e.to)!;
      const via: string[] = [];
      for (let c = a + 1; c < b; c++) {
        const id = `~${edgeKey(e)}#${c}`;
        columns[c].push(id);
        via.push(id);
      }
      routes.set(edgeKey(e), via);
      [e.from, ...via, e.to].reduce((prev, cur) => (link(prev, cur), cur));
    }

    // barycenter sweeps, right to left then left to right
    const sweep = (order: number[]) => {
      for (const i of order) {
        const ref = new Map<string, number>();
        const fixed = columns[i + 1] ?? columns[i - 1] ?? [];
        fixed.forEach((code, idx) => ref.set(code, idx));
        const score = (code: string) => {
          const pos = (neighbours.get(code) ?? []).map((n) => ref.get(n)).filter((v) => v !== undefined) as number[];
          return pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : Number.MAX_SAFE_INTEGER;
        };
        columns[i].sort((a, b) => score(a) - score(b) || compareCodes(a, b));
      }
    };
    sweep([...columns.keys()].reverse().slice(1));
    sweep([...columns.keys()].slice(1));

    return { columns, routes, nodes, edges, cycles };
  }

  /**
   * A fastest valid path to `target`: for every "one of" group pick the
   * alternative with the smallest own prerequisite closure (courses we have
   * no data for only win when nothing else is offered), then layer the
   * picks with Kahn's algorithm. Each layer is a semester whose courses only
   * need earlier semesters (no course-load limit is assumed).
   */
  plan(target: string): string[][] {
    const cost = new Map<string, Set<string>>(); // code -> closure including itself
    const picks = new Map<string, string[]>(); // code -> the prereq chosen per group
    const onStack = new Set<string>();

    const closure = (code: string): Set<string> => {
      const memo = cost.get(code);
      if (memo) return memo;
      if (onStack.has(code)) return new Set(); // cycle: stop here
      onStack.add(code);
      const result = new Set([code]);
      const chosenHere: string[] = [];
      for (const group of this.groups(code)) {
        let best: { alt: string; set: Set<string>; size: number } | null = null;
        for (const alt of [...group].sort(compareCodes)) {
          if (onStack.has(alt)) continue; // would close a cycle
          const c = closure(alt);
          // an unknown course looks free only because its prereqs are unknown
          const size = c.size + (this.courses.has(alt) ? 0 : 1000);
          if (!best || size < best.size) best = { alt, set: c, size };
        }
        if (best) {
          chosenHere.push(best.alt);
          for (const x of best.set) result.add(x);
        }
      }
      onStack.delete(code);
      cost.set(code, result);
      picks.set(code, chosenHere);
      return result;
    };

    const chosen = closure(target);
    // only the edges the closure actually picked, so a cycle can't deadlock Kahn
    const pending = new Map<string, Set<string>>();
    for (const code of chosen) pending.set(code, new Set(picks.get(code) ?? []));

    const semesters: string[][] = [];
    const done = new Set<string>();
    while (done.size < chosen.size) {
      const ready = [...pending.entries()]
        .filter(([code, reqs]) => !done.has(code) && [...reqs].every((r) => done.has(r)))
        .map(([code]) => code)
        .sort(compareCodes);
      if (!ready.length) break; // only a cycle remains
      ready.forEach((c) => done.add(c));
      semesters.push(ready);
    }
    return semesters;
  }
}

export function edgeKey(e: { from: string; to: string }) {
  return `${e.from}>${e.to}`;
}

export function codeOf(c: { subject: string; catalog_nbr: string }) {
  return `${c.subject.toUpperCase()} ${c.catalog_nbr.toUpperCase()}`;
}

/** "MAT 99" < "MAT 167" < "MAT 167L" < "PHY 101" */
export function compareCodes(a: string, b: string) {
  const [sa, na = ""] = a.split(" ");
  const [sb, nb = ""] = b.split(" ");
  if (sa !== sb) return sa < sb ? -1 : 1;
  const diff = parseInt(na, 10) - parseInt(nb, 10);
  if (diff) return diff;
  return na < nb ? -1 : na > nb ? 1 : 0;
}
