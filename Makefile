# Used in localnet's `ton wallet` command
WALLET_VERSION ?= V5R1

help: ## List of commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

compile: ## Compile contract
	npx blueprint build

test: ## Run contract tests
	npx blueprint test

deploy: ## Run deployment script
	npx blueprint run deploy

debug-tx: ## Execute a transaction to the Gateway
	@npx blueprint run debugTransaction

tx: ## Execute a transaction to the Gateway
	npx blueprint run transaction

tx-localnet: ## Execute a transaction to the Gateway on localnet
	@echo "Using mnemonic from env: WALLET_MNEMONIC && WALLET_VERSION"
	@echo "Wallet version '$(WALLET_VERSION)'. Mnemonic: '$(shell echo $(WALLET_MNEMONIC) | cut -c 1-20)...'"

	@npx blueprint run transaction \
		--custom http://127.0.0.1:8081/jsonRPC --custom-version v2 \
		--mnemonic

debug: ## Outputs Gateway's debug info
	npx blueprint run debug

lint: ## Lint the code
	npm run prettier

fmt: ## Format the code
	npm run prettier-fix

.PHONY: help compile test deploy tx tx-localnet debug debug-tx fmt