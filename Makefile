.PHONY: help

help: ## List of commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

compile: ## Compile contract
	npx blueprint build

test: ## Run contract tests
	npx blueprint test

deploy: ## Run deployment script
	npx blueprint run deploy
