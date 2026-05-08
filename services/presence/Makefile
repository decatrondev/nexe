.PHONY: build run test clean migrate

build:
	go build -o bin/presence ./cmd/main.go

run:
	go run ./cmd/main.go

test:
	go test ./...

clean:
	rm -rf bin/

migrate-up:
	migrate -path migrations -database "$(NEXE_DB_URL)" up

migrate-down:
	migrate -path migrations -database "$(NEXE_DB_URL)" down 1
