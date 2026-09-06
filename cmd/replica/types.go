package main

type ClassSection struct {
	ClassNbr        int    `json:"class_nbr"`
	Subject         string `json:"subject"`
	CatalogNbr      string `json:"catalog_nbr"`
	ClassSection    string `json:"class_section"`
	Descr           string `json:"descr"`
	Strm            string `json:"strm"`
	EnrollmentAvail int    `json:"enrollment_available"`
	ClassCapacity   int    `json:"class_capacity"`
	EnrlStatDescr   string `json:"enrl_stat_descr"`

	Campus          string `json:"campus,omitempty"`
	AcadCareer      string `json:"acad_career,omitempty"`
	SessionCode     string `json:"session_code,omitempty"`
	Days            string `json:"days,omitempty"`
	StartTime       string `json:"start_time,omitempty"`
	EndTime         string `json:"end_time,omitempty"`
	InstructorLast  string `json:"instructor_name,omitempty"`
	InstructorFirst string `json:"instr_first_name,omitempty"`
}

type ClassSearchResponse struct {
	PageCount int            `json:"pageCount"`
	Classes   []ClassSection `json:"classes"`
}

const dataDir = "data"
const pidFile = "data/replica.pid"
const logFile = "data/replica.log"
const startTimeFile = "data/replica.started"
const version = "0.1.0"
