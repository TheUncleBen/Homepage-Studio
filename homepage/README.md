# Controlled Homepage source

This is Homepage Studio's complete controlled native application source.
Build and deploy with the [root project instructions](../README.md), root
Dockerfile and [deployment guide](../docs/DEPLOYMENT.md). Studio ships one
application image and manages independent native workers inside that container.

The baseline is Homepage v2.6.0, commit
[`51cc1684f9f34a7877ed462b8f94c9cc687b4dde`](https://github.com/gethomepage/homepage/tree/51cc1684f9f34a7877ed462b8f94c9cc687b4dde).
The [original README](https://github.com/gethomepage/homepage/blob/51cc1684f9f34a7877ed462b8f94c9cc687b4dde/README.md)
and [Homepage documentation](https://gethomepage.dev/) retain upstream project
attribution and native configuration reference. Their standalone container,
authentication and startup instructions do not define Studio deployment.

Edit this source directly. Read [STUDIO-FORK.md](STUDIO-FORK.md) for provenance,
licenses and the curated update process. Native source, assets, documentation,
unit tests and the pinned dependency lock remain here. Root CI performs the
full native lint, test, production build and complete application qualification.
Upstream standalone Docker, development-cluster and CI definitions are retired.

Homepage's original authors and contributors retain their attribution and
[GPL license](LICENSE). Studio's original additions use the root AGPL license;
[third-party notices](../third-party/NOTICE.txt) preserve dependency and font
licenses and historical grants.
