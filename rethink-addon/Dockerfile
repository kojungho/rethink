# Home Assistant add-on wrapper for the upstream rethink runtime.
# Related files: config.yaml, run.sh, ../Dockerfile.
ARG BUILD_FROM=ghcr.io/plplaaa2/rethink:dev
FROM ${BUILD_FROM}

ARG BUILD_ARCH
ARG BUILD_VERSION

RUN apk add --no-cache curl jq

COPY run.sh /run.sh
RUN chmod 0755 /run.sh

LABEL \
    io.hass.name="Rethink" \
    io.hass.description="Local LG ThinQ cloud replacement" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.type="addon" \
    io.hass.version="${BUILD_VERSION}"

CMD ["/run.sh"]
