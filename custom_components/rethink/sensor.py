"""Official-style translated state sensors backed by Rethink MQTT topics."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from homeassistant.components import mqtt
from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN

MQTT_PREFIX: Final = "rethink"


@dataclass(frozen=True, kw_only=True)
class RethinkStateDescription(SensorEntityDescription):
    """Description of one Rethink current-state sensor."""

    legacy_unique_id: str
    target_entity_id: str
    topic: str
    options: tuple[str, ...]
    value_map: dict[str, str]


DISHWASHER_VALUES: Final = {
    "OFF": "off",
    "INITIAL": "initial",
    "RUNNING": "running",
    "PAUSE": "pause",
    "END": "end",
    "RESERVED": "reserved",
    "NIGHT_DRY": "night_dry",
    "ERROR": "error",
    "RINSING": "rinsing",
    "POWER_FAIL": "power_fail",
    "DRYING": "drying",
    "CANCEL": "cancel",
}

WASHER_VALUES: Final = {
    "POWEROFF": "power_off",
    "INITIAL": "initial",
    "PAUSE": "pause",
    "DETECTING": "detecting",
    "DISPLAY_LOAD": "display_load",
    "ADD_DRAIN": "add_drain",
    "DETERGENT_AMOUNT": "detergent_amount",
    "RESERVED": "reserved",
    "SOAK": "soaking",
    "PREWASH": "prewash",
    "RUNNING": "running",
    "RINSING": "rinsing",
    "RINSEHOLD": "rinse_hold",
    "SPINNING": "spinning",
    "DRYING": "drying",
    "END": "end",
    "COOLDOWN": "cooldown",
    "COOLFAN": "cool_fan",
    "STEAM_SOFTENER": "steam_softening",
    "REFRESHING": "refreshing",
    "ERROR": "error",
    "ERROR_AUTO_OFF": "error_auto_off",
    "SHOES_MODULE": "shoes_module",
    "DOING_DIAGNOSIS": "doing_diagnosis",
    "DOING_FIRM_UPDATE": "doing_firmware_update",
    "FROZEN_PREVENT_INITIAL": "frozen_prevent_initial",
    "FROZEN_PREVENT_PAUSE": "frozen_prevent_pause",
    "FROZEN_PREVENT_RUNNING": "frozen_prevent_running",
    "SERVICE": "service",
    "TEST": "test",
    "AUTOTEST": "auto_test",
    "FIRMWARE_UPDATE": "firmware_update",
    "AUDIBLE_DIAGNOSIS": "audible_diagnosis",
    "AUTO_DT_OPEN_PAUSE": "auto_door_open_pause",
    "CONFIRM_START_FOR_CONTROL": "confirm_start_for_control",
    "CLOTHING_RECOGNITION": "clothing_recognition",
    "DETERGENT_INPUT": "detergent_input",
    "SOFTENER_INPUT": "softener_input",
    "POLLUTION_DETECTING": "pollution_detecting",
    "TUB_CLEANING": "tub_cleaning",
    "STEAM": "steam",
    "LAUNDRYCARE": "laundry_care",
    "EZDISPENSE_CLEANING": "ezdispense_cleaning",
}

DRYER_VALUES: Final = {
    "POWEROFF": "power_off",
    "INITIAL": "initial",
    "RUNNING": "running",
    "PAUSE": "pause",
    "END": "end",
    "ERROR": "error",
    "AUDIBLE_DIAGNOSIS": "audible_diagnosis",
    "DRYING": "drying",
    "COOLING": "cooling",
    "WRINKLECARE": "wrinkle_care",
    "RESERVED": "reserved",
    "DELAYLOAD": "delay_load",
    "SPINREERVE": "spin_reserve",
    "AUTOTEST": "auto_test",
    "DETECTING": "detecting",
    "STEAM": "steam",
    "CLOTHING_RECOGNITION": "clothing_recognition",
    "CONDENSER_CLEAN": "condenser_clean",
    "BEDDINGBRUSHING": "bedding_brushing",
    "DRY_REFRESHING": "dry_refreshing",
    "ALLERGYCARE": "allergy_care",
    "CONDENSERCARE": "condenser_care",
    "DRYREADY": "dry_ready",
    "LAUNDRYCARE": "laundry_care",
    "DEHUMIDIFICATION": "dehumidification",
    "DEHUMIDIFICATION_END": "dehumidification_end",
    "DRUM_CARE": "drum_care",
    "AI_LOAD_CHECK": "ai_load_check",
}

STATE_SENSORS: Final = (
    RethinkStateDescription(
        key="dishwasher_current_state",
        translation_key="dishwasher_current_state",
        device_class=SensorDeviceClass.ENUM,
        legacy_unique_id="87624224-726e-11d7-91ca-2028bcd3177e-state",
        target_entity_id="sensor.lg_dishwasher_state",
        topic=f"{MQTT_PREFIX}/87624224-726e-11d7-91ca-2028bcd3177e/state",
        options=tuple(DISHWASHER_VALUES.values()),
        value_map=DISHWASHER_VALUES,
    ),
    RethinkStateDescription(
        key="washer_current_state",
        translation_key="washer_current_state",
        device_class=SensorDeviceClass.ENUM,
        legacy_unique_id="353b81b8-37fa-1e9b-a09a-1c3929a124c9-washer-state",
        target_entity_id="sensor.lg_washtower_washer_state",
        topic=f"{MQTT_PREFIX}/353b81b8-37fa-1e9b-a09a-1c3929a124c9/washer/state",
        options=tuple(WASHER_VALUES.values()),
        value_map=WASHER_VALUES,
    ),
    RethinkStateDescription(
        key="dryer_current_state",
        translation_key="dryer_current_state",
        device_class=SensorDeviceClass.ENUM,
        legacy_unique_id="353b81b8-37fa-1e9b-a09a-1c3929a124c9-dryer-state",
        target_entity_id="sensor.lg_washtower_dryer_state",
        topic=f"{MQTT_PREFIX}/353b81b8-37fa-1e9b-a09a-1c3929a124c9/dryer/state",
        options=tuple(DRYER_VALUES.values()),
        value_map=DRYER_VALUES,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the three translated current-state sensors."""
    registry = er.async_get(hass)
    entities = []
    for description in STATE_SENSORS:
        legacy_entity_id = registry.async_get_entity_id(
            "sensor", mqtt.DOMAIN, description.legacy_unique_id
        )
        legacy_entry = registry.async_get(legacy_entity_id) if legacy_entity_id else None
        current_entity_id = registry.async_get_entity_id(
            "sensor", DOMAIN, f"rethink-{description.key}"
        )
        current_entry = registry.async_get(current_entity_id) if current_entity_id else None
        target_device_id = (
            legacy_entry.device_id
            if legacy_entry
            else current_entry.device_id
            if current_entry
            else None
        )
        if legacy_entity_id:
            registry.async_remove(legacy_entity_id)
        entities.append(RethinkStateSensor(description, target_device_id))
    async_add_entities(entities)


class RethinkStateSensor(SensorEntity):
    """Rethink current state with English native state and frontend translation."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, description: RethinkStateDescription, target_device_id: str | None) -> None:
        self.entity_description = description
        self._attr_unique_id = f"rethink-{description.key}"
        self._attr_options = list(description.options)
        self._attr_native_value = None
        self._target_device_id = target_device_id

    async def async_added_to_hass(self) -> None:
        """Subscribe to the raw English Rethink state topic."""
        await super().async_added_to_hass()
        registry = er.async_get(self.hass)
        entry = registry.async_get(self.entity_id)
        if entry:
            registry.async_update_entity(
                self.entity_id,
                new_entity_id=self.entity_description.target_entity_id,
                device_id=self._target_device_id,
            )
        self.async_on_remove(
            await mqtt.async_subscribe(
                self.hass,
                self.entity_description.topic,
                self._message_received,
                qos=0,
            )
        )

    @callback
    def _message_received(self, message: mqtt.ReceiveMessage) -> None:
        raw = str(message.payload)
        self._attr_native_value = self.entity_description.value_map.get(raw, raw.lower())
        self.async_write_ha_state()
