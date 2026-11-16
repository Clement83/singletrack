# BRouter auto-hébergé (#1340) : serveur de routage HTTP, profil VTT « mtb ».
# Pas d'image officielle sur Docker Hub : on récupère la release GitHub (jar + profils).
FROM eclipse-temurin:21-jre
ARG BROUTER_VERSION=1.7.10
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/b.zip "https://github.com/abrensch/brouter/releases/download/v${BROUTER_VERSION}/brouter-${BROUTER_VERSION}.zip" \
 && unzip -q /tmp/b.zip -d /tmp/b && mkdir -p /brouter && mv /tmp/b/brouter-*/brouter-*-all.jar /brouter/brouter.jar \
 && mv /tmp/b/brouter-*/profiles2 /brouter/profiles2 && rm -rf /tmp/b /tmp/b.zip
WORKDIR /brouter
# Profils singletrack (#1385) : montée chère, descente gratuite ; musculaire et VAE.
COPY profiles/*.brf /brouter/profiles2/
# Téléchargement des tuiles au premier lancement (#1484), appelé par le service `brouter-init` du compose de distribution.
COPY fetch-segments.sh /brouter/fetch-segments.sh
RUN chmod +x /brouter/fetch-segments.sh
EXPOSE 17777
# <segments> <profils> <profils perso> <port> <threads max> <adresse d'écoute>
CMD ["java", "-Xmx256M", "-Xms64M", "-cp", "brouter.jar", "btools.server.RouteServer", "/segments", "/brouter/profiles2", "/brouter/profiles2", "17777", "4", "0.0.0.0"]
