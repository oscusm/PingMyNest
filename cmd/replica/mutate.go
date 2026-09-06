package main

import (
	"fmt"
	"net/http"
	"os"
)

func cmdList() {
	files, err := os.ReadDir(dataDir)
	if err != nil {
		fmt.Println("no data populated yet — run `replica --populate <SUBJECT> <CATALOG>` first")
		return
	}
	fmt.Println("populated:")
	for _, f := range files {
		fmt.Println(" -", f.Name())
	}
}

func cmdMutate(classNbrStr, availStr string) {
	url := fmt.Sprintf("http://localhost:8081/mutate?class_nbr=%s&avail=%s", classNbrStr, availStr)
	resp, err := http.Post(url, "text/plain", nil)
	if err != nil {
		fmt.Println("error: is `replica --watch` running? ", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	fmt.Printf("class_nbr=%s set to avail=%s\n", classNbrStr, availStr)
}
