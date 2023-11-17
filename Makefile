.PHONY: serve
serve:
	@echo "Serving on http://localhost:8000"
	deno run --watch -A --unstable ./main.ts

.PHONY: prod-serve
prod-serve:
	@echo "Serving on http://localhost:80"
	ENV=prod deno run -A --unstable ./main.ts
