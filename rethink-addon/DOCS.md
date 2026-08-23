# Rethink Home Assistant Add-on

## Configuration

- `hostname`: Local DNS name redirected to the Home Assistant host. The default is `rethink.home.arpa`.
- `mqtt_auto_discovery`: Use MQTT connection information provided by Home Assistant Supervisor. Enabled by default.
- `mqtt_server`: Manual fallback MQTT URL, including the scheme and port (for example, `mqtt://192.168.1.10:1883`).
- `mqtt_username`: Manual fallback MQTT user ID.
- `mqtt_password`: Manual fallback MQTT password.
- `discovery_prefix`: Home Assistant MQTT discovery prefix.
- `rethink_prefix`: MQTT topic prefix used by Rethink.

When automatic discovery is enabled and an MQTT service is available, the discovered values take precedence. If discovery fails, Rethink uses the manual MQTT options. Disable automatic discovery to always use the manual values.

## DNAT network mode

This add-on uses DNAT mode by default. Do not rewrite LG cloud hostnames to the Home Assistant address. Configure the router to redirect only the selected appliance source addresses:

- TCP 443 to the Home Assistant host on TCP 443.
- TCP 8883 to the Home Assistant host on TCP 8883.
- Apply source NAT/masquerading to both redirected flows so replies return through the router.

The DNAT rules must be restricted to the LG appliance addresses. Never redirect TCP 443 or TCP 8883 for the whole LAN.

Rethink obtains the official `/route` response using public DNS, while serving an SNI-specific certificate signed by the CA already trusted by the appliance. The `rethink.home.arpa` DNS rewrite is not required in DNAT mode.

Bridge registration preserves the existing ThinQ account registration. ThinQ1 bridge activation is intentionally blocked because a non-destructive registration path has not been verified for that protocol.

The management interface is available from the add-on page through **Open Web UI**.

Do not publish the appliance or management ports to the internet.
