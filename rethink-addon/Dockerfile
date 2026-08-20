# Build the public master branch directly so add-on installation uses released source only.
# Related files: config.yaml, run.sh, ../Dockerfile, ../package.json.
FROM alpine:3.20 AS build

# Pinning the source revision makes Docker invalidate the remote-archive layer
# when the add-on is rebuilt after a source update.
ARG RETHINK_REF=06ce6938d9857ff13b67736af85b77ac4b5dcb33

WORKDIR /src

RUN apk add --no-cache nodejs npm

ADD https://github.com/kojungho/rethink/archive/${RETHINK_REF}.tar.gz /tmp/rethink.tar.gz
RUN tar -xzf /tmp/rethink.tar.gz --strip-components=1 -C /src \
    && npm ci --ignore-scripts \
    && npm run build \
    && npm prune --omit=dev

FROM alpine:3.20 AS runtime

ARG BUILD_ARCH
ARG BUILD_VERSION

WORKDIR /app

RUN apk add --no-cache curl jq nodejs openssl \
    && mkdir -p /app/data

COPY --from=build /src/package.json /src/package-lock.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist

COPY run.sh /run.sh
RUN sed -i 's/\r$//' /run.sh \
    && chmod 0755 /run.sh

LABEL \
    io.hass.name="Rethink" \
    io.hass.description="Local LG ThinQ cloud replacement" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.type="addon" \
    io.hass.version="${BUILD_VERSION}"

CMD ["/run.sh"]
