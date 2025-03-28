help: ## List of commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

compile: ## Compile contract
	npx blueprint build

test: ## Run contract tests
	npx blueprint test

deploy: ## Run deployment script
	npx blueprint run deploy

tx: ## Execute a transaction to the Gateway
	npx blueprint run transaction

debug: ## Outputs Gateway's debug info
	npx blueprint run debug

lint: ## Lint the code
	npm run prettier

fmt: ## Format the code
	npm run prettier-fix

.PHONY: help compile test deploy tx debug fmt