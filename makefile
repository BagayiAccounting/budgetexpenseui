publish_image:
	docker build -t mwaaas/bagayi-accountingfrontend:latest -f Dockerfile .
	docker push mwaaas/bagayi-accountingfrontend:latest