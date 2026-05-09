package repository

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

// jsonScanner wraps a destination pointer to implement sql.Scanner for JSONB columns.
type jsonScanner struct {
	dest interface{}
}

func scanJSON(dest interface{}) *jsonScanner {
	return &jsonScanner{dest: dest}
}

func (s *jsonScanner) Scan(src interface{}) error {
	if src == nil {
		return nil
	}

	var data []byte
	switch v := src.(type) {
	case []byte:
		data = v
	case string:
		data = []byte(v)
	default:
		return fmt.Errorf("jsonScanner: unsupported type %T", src)
	}

	if err := json.Unmarshal(data, s.dest); err != nil {
		return fmt.Errorf("jsonScanner: %w", err)
	}
	return nil
}

func (s *jsonScanner) Value() (driver.Value, error) {
	if s.dest == nil {
		return "null", nil
	}
	b, err := json.Marshal(s.dest)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

// stringArrayScanner wraps a *[]string to implement sql.Scanner for PostgreSQL array columns.
type stringArrayScanner struct {
	dest *[]string
}

func scanStringArray(dest *[]string) *stringArrayScanner {
	return &stringArrayScanner{dest: dest}
}

func (s *stringArrayScanner) Scan(src interface{}) error {
	if src == nil {
		*s.dest = []string{}
		return nil
	}

	var data []byte
	switch v := src.(type) {
	case []byte:
		data = v
	case string:
		data = []byte(v)
	default:
		return fmt.Errorf("stringArrayScanner: unsupported type %T", src)
	}

	var result []string
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("stringArrayScanner: %w", err)
	}
	*s.dest = result
	return nil
}

func (s *stringArrayScanner) Value() (driver.Value, error) {
	if s.dest == nil || len(*s.dest) == 0 {
		return "[]", nil
	}
	b, err := json.Marshal(*s.dest)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}
