COMPOSE := docker compose
BACKEND_PROJECTS := bff,database,recommender,logger

.DEFAULT_GOAL := help
.PHONY: help build check lint test up up-recreate down ps logs logs-bff logs-database logs-worker migrate worker

help: ## Exibe os comandos disponíveis para o backend
	@awk 'BEGIN {FS = ":.*##"}; /^[a-zA-Z0-9_-]+:.*##/ {printf "%-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Compila o BFF do backend
	npx nx run bff:build

check: ## Executa a verificação de tipos do backend
	npx nx run-many -t typecheck --projects=$(BACKEND_PROJECTS)

lint: check ## Executa a análise estática disponível (TypeScript)

test: ## Executa as suítes de teste configuradas do backend
	npx nx run-many -t test --projects=logger,recommender

up: ## Sobe banco, migration, BFF e worker
	$(COMPOSE) up -d --remove-orphans

up-recreate: ## Recria os containers do backend sem apagar o volume do banco
	$(COMPOSE) up -d --force-recreate --remove-orphans

down: ## Para o backend sem apagar os dados locais
	$(COMPOSE) down --remove-orphans

ps: ## Mostra o estado dos serviços
	$(COMPOSE) ps --all

logs: ## Acompanha os logs de banco, BFF e worker
	$(COMPOSE) logs -f database bff worker

logs-bff: ## Acompanha os logs do BFF
	$(COMPOSE) logs -f bff

logs-database: ## Acompanha os logs do libSQL
	$(COMPOSE) logs -f database

logs-worker: ## Acompanha os logs do worker de dataset
	$(COMPOSE) logs -f worker

migrate: ## Executa somente a migration do banco
	$(COMPOSE) run --rm --no-deps migrate

worker: ## Executa manualmente o worker one-shot de importação
	$(COMPOSE) run --rm --no-deps worker
