COMPOSE_FILES := -f docker-compose.yml $(if $(wildcard docker-compose.override.yml),-f docker-compose.override.yml) $(if $(wildcard docker-compose.corporate-ca.yml),-f docker-compose.corporate-ca.yml)
COMPOSE := docker compose $(COMPOSE_FILES)
BACKEND_PROJECTS := bff,database,recommender,logger

.DEFAULT_GOAL := help
.PHONY: help build check lint test up up-recreate down ps logs logs-bff logs-database migrate process-queue train

help: ## Exibe os comandos disponíveis para o backend
	@awk 'BEGIN {FS = ":.*##"}; /^[a-zA-Z0-9_-]+:.*##/ {printf "%-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Compila o BFF do backend
	npx nx run bff:build

check: ## Executa a verificação de tipos do backend
	npx nx run-many -t typecheck --projects=$(BACKEND_PROJECTS)

lint: check ## Executa a análise estática disponível (TypeScript)

test: ## Executa as suítes de teste configuradas do backend
	npx nx run-many -t test --projects=logger,recommender

up: ## Sobe banco, migration e BFF
	$(COMPOSE) up -d --remove-orphans

up-recreate: ## Recria os containers do backend sem apagar o volume do banco
	$(COMPOSE) up -d --force-recreate --remove-orphans

down: ## Para o backend sem apagar os dados locais
	$(COMPOSE) down --remove-orphans

ps: ## Mostra o estado dos serviços
	$(COMPOSE) ps --all

logs: ## Acompanha os logs de banco e BFF
	$(COMPOSE) logs -f database bff

logs-bff: ## Acompanha os logs do BFF
	$(COMPOSE) logs -f bff

logs-database: ## Acompanha os logs do libSQL
	$(COMPOSE) logs -f database

migrate: ## Executa somente a migration do banco
	$(COMPOSE) run --rm --no-deps migrate

process-queue: ## Processa manualmente jobs pendentes da fila
	$(COMPOSE) exec bff npx nx run recommender:import-dataset

train: ## Treina e exporta o modelo TensorFlow offline
	$(COMPOSE) run --rm train
