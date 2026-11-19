# Self-hosted BRouter (#1340): HTTP routing server, "mtb" mountain-bike profile.
# No official image on Docker Hub: we fetch the GitHub release (jar + profiles).
FROM eclipse-temurin:21-jre
ARG BROUTER_VERSION=1.7.10
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/b.zip "https://github.com/abrensch/brouter/releases/download/v${BROUTER_VERSION}/brouter-${BROUTER_VERSION}.zip" \
 && unzip -q /tmp/b.zip -d /tmp/b && mkdir -p /brouter && mv /tmp/b/brouter-*/brouter-*-all.jar /brouter/brouter.jar \
 && mv /tmp/b/brouter-*/profiles2 /brouter/profiles2 && rm -rf /tmp/b /tmp/b.zip
WORKDIR /brouter
# singletrack profiles (#1385): climbing is expensive, descending is free; muscle bike and e-bike.
COPY profiles/*.brf /brouter/profiles2/
# Tile download on first start (#1484), called by the `brouter-init` service of the distribution compose file.
COPY fetch-segments.sh /brouter/fetch-segments.sh
RUN chmod +x /brouter/fetch-segments.sh
EXPOSE 17777
# <segments> <profiles> <custom profiles> <port> <max threads> <listen address>
CMD ["java", "-Xmx256M", "-Xms64M", "-cp", "brouter.jar", "btools.server.RouteServer", "/segments", "/brouter/profiles2", "/brouter/profiles2", "17777", "4", "0.0.0.0"]
