package repository

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

// jsonArrayScanner wraps a *[]string to implement sql.Scanner for JSONB array columns.
type jsonArrayScanner struct {
	dest *[]string
}

func pqJSONArray(dest *[]string) *jsonArrayScanner {
	return &jsonArrayScanner{dest: dest}
}

func (s *jsonArrayScanner) Scan(src interface{}) error {
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
		return fmt.Errorf("jsonArrayScanner: unsupported type %T", src)
	}

	var result []string
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("jsonArrayScanner: %w", err)
	}
	*s.dest = result
	return nil
}

func (s *jsonArrayScanner) Value() (driver.Value, error) {
	if s.dest == nil || len(*s.dest) == 0 {
		return "[]", nil
	}
	b, err := json.Marshal(*s.dest)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}
