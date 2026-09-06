package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func classSearchHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	subject := q.Get("subject")
	catalogNbrFilter := q.Get("catalog_nbr")
	campusFilter := q.Get("campus")
	careerFilter := q.Get("x_acad_career")
	sessionFilter := q.Get("session_code")
	daysFilter := q.Get("days")
	instructorFilter := q.Get("instructor_name")

	var merged ClassSearchResponse
	merged.PageCount = 1

	files, _ := os.ReadDir(dataDir)
	for _, file := range files {
		name := file.Name()
		if !strings.HasPrefix(name, subject+"_") || !strings.HasSuffix(name, ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dataDir, name))
		if err != nil {
			continue
		}
		var result ClassSearchResponse
		if err := json.Unmarshal(data, &result); err != nil {
			continue
		}
		for _, c := range result.Classes {
			if catalogNbrFilter != "" && c.CatalogNbr != catalogNbrFilter {
				continue
			}
			if campusFilter != "" && c.Campus != "" && c.Campus != campusFilter {
				continue
			}
			if careerFilter != "" && c.AcadCareer != "" && c.AcadCareer != careerFilter {
				continue
			}
			if sessionFilter != "" && c.SessionCode != "" && c.SessionCode != sessionFilter {
				continue
			}
			if daysFilter != "" && c.Days != "" && c.Days != daysFilter {
				continue
			}
			if instructorFilter != "" && c.InstructorLast != "" && c.InstructorLast != instructorFilter {
				continue
			}
			merged.Classes = append(merged.Classes, c)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(merged)
}

func classSearchOptionsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"campuses":     []string{"HBG", "ONLNE"},
		"careers":      []string{"UGRD", "GRAD"},
		"sessionCodes": []string{"1", "5W1", "5W2", "8W1", "8W2"},
	})
}

func mutateHandler(w http.ResponseWriter, r *http.Request) {
	classNbrStr := r.URL.Query().Get("class_nbr")
	availStr := r.URL.Query().Get("avail")
	var classNbr, avail int
	fmt.Sscan(classNbrStr, &classNbr)
	fmt.Sscan(availStr, &avail)

	files, _ := os.ReadDir(dataDir)
	for _, file := range files {
		path := filepath.Join(dataDir, file.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var result ClassSearchResponse
		json.Unmarshal(data, &result)

		changed := false
		for i := range result.Classes {
			if result.Classes[i].ClassNbr == classNbr {
				result.Classes[i].EnrollmentAvail = avail
				changed = true
			}
		}
		if changed {
			f, _ := os.Create(path)
			enc := json.NewEncoder(f)
			enc.SetIndent("", "  ")
			enc.Encode(result)
			f.Close()
			fmt.Printf("[replica] class_nbr=%d set to avail=%d\n", classNbr, avail)
		}
	}
	w.Write([]byte("ok"))
}

func startServer(port string) {
	http.HandleFunc("/mock-class-search", classSearchHandler)
	http.HandleFunc("/mock-class-search-options", classSearchOptionsHandler)
	http.HandleFunc("/mutate", mutateHandler)

	fmt.Printf("replica watching on :%s\n", port)
	fmt.Println("  GET  /mock-class-search?subject=MAT&catalog_nbr=167&campus=HBG&x_acad_career=UGRD")
	fmt.Println("  GET  /mock-class-search-options?institution=USM01&term=4271&x_acad_career=UGRD")
	fmt.Println("  POST /mutate?class_nbr=1178&avail=3")
	http.ListenAndServe(":"+port, nil)
}
