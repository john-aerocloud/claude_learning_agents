INFRA = src/infra
APP   = src/app

.PHONY: build deploy deploy-infra deploy-app diff destroy bootstrap

build:
	cd $(APP) && npm run build

deploy: deploy-infra deploy-app

deploy-infra:
	$(MAKE) -C $(INFRA) deploy

deploy-app: build
	$(MAKE) -C $(INFRA) deploy-app

diff:
	$(MAKE) -C $(INFRA) diff

destroy:
	$(MAKE) -C $(INFRA) destroy

bootstrap:
	$(MAKE) -C $(INFRA) bootstrap
