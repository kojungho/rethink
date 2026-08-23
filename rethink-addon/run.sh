#!/bin/sh
# Generate rethink runtime configuration from Home Assistant add-on options.
# Related files: config.yaml, Dockerfile, ../config.jsonc, ../rethink-cloud.ts.
set -eu

OPTIONS_FILE=/data/options.json
RUNTIME_CONFIG=/data/config.json
RUNTIME_CONFIG_TMP=/data/config.json.tmp

if [ ! -f "$OPTIONS_FILE" ]; then
    echo "[ERROR] Home Assistant add-on options were not found" >&2
    exit 1
fi

hostname="$(jq -er '.hostname' "$OPTIONS_FILE")"
mqtt_auto_discovery="$(jq -er '.mqtt_auto_discovery' "$OPTIONS_FILE")"
mqtt_server="$(jq -er '.mqtt_server' "$OPTIONS_FILE")"
mqtt_username="$(jq -er '.mqtt_username' "$OPTIONS_FILE")"
mqtt_password="$(jq -er '.mqtt_password' "$OPTIONS_FILE")"
discovery_prefix="$(jq -er '.discovery_prefix' "$OPTIONS_FILE")"
rethink_prefix="$(jq -er '.rethink_prefix' "$OPTIONS_FILE")"

mqtt_source=manual
if [ "$mqtt_auto_discovery" = "true" ] && [ -n "${SUPERVISOR_TOKEN:-}" ]; then
    mqtt_service="$(
        curl --fail --silent --show-error --max-time 10 \
            --header "Authorization: Bearer $SUPERVISOR_TOKEN" \
            http://supervisor/services/mqtt 2>/dev/null || true
    )"

    if [ "$(printf '%s' "$mqtt_service" | jq -r '.result // empty' 2>/dev/null)" = "ok" ]; then
        discovered_host="$(printf '%s' "$mqtt_service" | jq -r '.data.host // empty')"
        discovered_port="$(printf '%s' "$mqtt_service" | jq -r '.data.port // empty')"
        if [ -n "$discovered_host" ] && [ -n "$discovered_port" ]; then
            discovered_ssl="$(printf '%s' "$mqtt_service" | jq -r '.data.ssl // false')"
            if [ "$discovered_ssl" = "true" ]; then
                discovered_scheme=mqtts
            else
                discovered_scheme=mqtt
            fi
            mqtt_server="$discovered_scheme://$discovered_host:$discovered_port"
            mqtt_username="$(printf '%s' "$mqtt_service" | jq -r '.data.username // ""')"
            mqtt_password="$(printf '%s' "$mqtt_service" | jq -r '.data.password // ""')"
            mqtt_source=supervisor
        fi
    fi
fi

case "$mqtt_server" in
    mqtt://*|mqtts://*) ;;
    *)
        echo "[ERROR] mqtt_server must start with mqtt:// or mqtts://" >&2
        exit 1
        ;;
esac

jq -n \
    --arg hostname "$hostname" \
    --arg mqtt_server "$mqtt_server" \
    --arg mqtt_username "$mqtt_username" \
    --arg mqtt_password "$mqtt_password" \
    --arg discovery_prefix "$discovery_prefix" \
    --arg rethink_prefix "$rethink_prefix" \
    '{
        hostname: $hostname,
        homeassistant: {
            mqtt_url: $mqtt_server,
            discovery_prefix: $discovery_prefix,
            rethink_prefix: $rethink_prefix,
            mqtt_user: $mqtt_username,
            mqtt_pass: $mqtt_password
        },
        ca_key_file: "ca.key",
        ca_cert_file: "ca.cert",
        https_port: 443,
        mqtts_port: 8883,
        mqtt_port: 1884,
        thinq1_https_port: 46030,
        thinq1_port: 47878,
        management_port: 44401,
        bridge: { storage_path: "state" },
        dnat: { enabled: true, dns_servers: ["1.1.1.1", "8.8.8.8"] },
        log: ["status", "incoming", "HTTPS", "publish", "MGMT"]
    }' > "$RUNTIME_CONFIG_TMP"

chmod 0600 "$RUNTIME_CONFIG_TMP"
mv "$RUNTIME_CONFIG_TMP" "$RUNTIME_CONFIG"

if [ "$mqtt_source" = "supervisor" ]; then
    echo "[INFO] Using MQTT service discovered through Home Assistant Supervisor"
elif [ "$mqtt_auto_discovery" = "true" ]; then
    echo "[WARN] Home Assistant MQTT service was unavailable; using manual MQTT options"
else
    echo "[INFO] MQTT auto-discovery is disabled; using manual MQTT options"
fi
echo "[INFO] Starting Rethink with MQTT server $mqtt_server"
exec node /app/dist/rethink-cloud.js "$RUNTIME_CONFIG"
