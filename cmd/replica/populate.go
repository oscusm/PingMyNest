package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"os"
	"path/filepath"
	"time"
)

func cmdPopulate(subject, catalogNbr string) {
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Timeout: 10 * time.Second, Jar: jar}

	warmupReq, _ := http.NewRequest("GET", "https://soar.usm.edu/psc/guest/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_Main", nil)
	warmupReq.Header.Set("User-Agent", "PingMyNest-replica/0.1 (student project)")
	warmupResp, err := client.Do(warmupReq)
	if err != nil {
		fmt.Println("error warming up session:", err)
		os.Exit(1)
	}
	warmupResp.Body.Close()

	url := fmt.Sprintf(
		"https://soar.usm.edu/psc/guest/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_ClassSearch?institution=USM01&term=4271&subject=%s&catalog_nbr=%s&campus=HBG&x_acad_career=UGRD&enrl_stat=O&crse_attr=&crse_attr_value=&session_code=1&page=1",
		subject, catalogNbr,
	)

	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "PingMyNest-replica/0.1 (student project)")

	resp, err := client.Do(req)
	if err != nil {
		fmt.Println("error fetching from USM:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	var result ClassSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		fmt.Println("error decoding USM response (may need session cookie or USM may be unavailable):", err)
		os.Exit(1)
	}

	os.MkdirAll(dataDir, 0755)
	filename := filepath.Join(dataDir, fmt.Sprintf("%s_%s.json", subject, catalogNbr))
	f, err := os.Create(filename)
	if err != nil {
		fmt.Println("error creating file:", err)
		os.Exit(1)
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	enc.Encode(result)

	fmt.Printf("saved %d section(s) to %s\n", len(result.Classes), filename)
}
