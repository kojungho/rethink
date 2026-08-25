"""Official-style translated sensors backed by Rethink MQTT topics."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from homeassistant.components import mqtt
from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN

MQTT_PREFIX: Final = "rethink"


@dataclass(frozen=True, kw_only=True)
class RethinkSensorDescription(SensorEntityDescription):
    """Description of one translated Rethink sensor."""

    device_key: str
    device_name: str
    device_model: str
    target_entity_id: str
    topic: str | None
    options: tuple[str, ...]
    value_map: dict[str, str]
    default_value: str = "waiting_for_data"
    unknown_value: str = "unknown_error"
    legacy_unique_id: str | None = None


DISHWASHER_VALUES: Final = {
    "OFF": "off", "INITIAL": "initial", "RUNNING": "running", "PAUSE": "pause",
    "END": "end", "RESERVED": "reserved", "NIGHT_DRY": "night_dry", "ERROR": "error",
    "RINSING": "rinsing", "POWER_FAIL": "power_fail", "DRYING": "drying", "CANCEL": "cancel",
}

WASHER_VALUES: Final = {
    "POWEROFF": "power_off", "INITIAL": "initial", "PAUSE": "pause", "DETECTING": "detecting",
    "DISPLAY_LOAD": "display_load", "ADD_DRAIN": "add_drain", "DETERGENT_AMOUNT": "detergent_amount",
    "RESERVED": "reserved", "SOAK": "soaking", "PREWASH": "prewash", "RUNNING": "running",
    "RINSING": "rinsing", "RINSEHOLD": "rinse_hold", "SPINNING": "spinning", "DRYING": "drying",
    "END": "end", "COOLDOWN": "cooldown", "COOLFAN": "cool_fan", "STEAM_SOFTENER": "steam_softening",
    "REFRESHING": "refreshing", "ERROR": "error", "ERROR_AUTO_OFF": "error_auto_off",
    "SHOES_MODULE": "shoes_module", "DOING_DIAGNOSIS": "doing_diagnosis",
    "DOING_FIRM_UPDATE": "doing_firmware_update", "FROZEN_PREVENT_INITIAL": "frozen_prevent_initial",
    "FROZEN_PREVENT_PAUSE": "frozen_prevent_pause", "FROZEN_PREVENT_RUNNING": "frozen_prevent_running",
    "SERVICE": "service", "TEST": "test", "AUTOTEST": "auto_test", "FIRMWARE_UPDATE": "firmware_update",
    "AUDIBLE_DIAGNOSIS": "audible_diagnosis", "AUTO_DT_OPEN_PAUSE": "auto_door_open_pause",
    "CONFIRM_START_FOR_CONTROL": "confirm_start_for_control", "CLOTHING_RECOGNITION": "clothing_recognition",
    "DETERGENT_INPUT": "detergent_input", "SOFTENER_INPUT": "softener_input",
    "POLLUTION_DETECTING": "pollution_detecting", "TUB_CLEANING": "tub_cleaning", "STEAM": "steam",
    "LAUNDRYCARE": "laundry_care", "EZDISPENSE_CLEANING": "ezdispense_cleaning",
}

DRYER_VALUES: Final = {
    "POWEROFF": "power_off", "INITIAL": "initial", "RUNNING": "running", "PAUSE": "pause", "END": "end",
    "ERROR": "error", "AUDIBLE_DIAGNOSIS": "audible_diagnosis", "DRYING": "drying", "COOLING": "cooling",
    "WRINKLECARE": "wrinkle_care", "RESERVED": "reserved", "DELAYLOAD": "delay_load",
    "SPINREERVE": "spin_reserve", "AUTOTEST": "auto_test", "DETECTING": "detecting", "STEAM": "steam",
    "CLOTHING_RECOGNITION": "clothing_recognition", "CONDENSER_CLEAN": "condenser_clean",
    "BEDDINGBRUSHING": "bedding_brushing", "DRY_REFRESHING": "dry_refreshing", "ALLERGYCARE": "allergy_care",
    "CONDENSERCARE": "condenser_care", "DRYREADY": "dry_ready", "LAUNDRYCARE": "laundry_care",
    "DEHUMIDIFICATION": "dehumidification", "DEHUMIDIFICATION_END": "dehumidification_end",
    "DRUM_CARE": "drum_care", "AI_LOAD_CHECK": "ai_load_check",
}

WASHER_ERROR_VALUES: Final = {
    "NONE": "no_error", "ERROR_PUMP": "washer_pump", "ERROR_IE": "washer_ie",
    "ERROR_OE": "washer_oe", "ERROR_UE": "washer_ue", "ERROR_FE": "washer_fe",
    "ERROR_AE": "washer_ae", "ERROR_PE": "washer_pe", "ERROR_TE": "washer_te",
    "ERROR_LE": "washer_le", "ERROR_CE": "washer_ce", "ERROR_DHE": "washer_dhe",
    "ERROR_PFE": "washer_pfe", "ERROR_FF": "washer_ff", "ERROR_DCE": "washer_dce",
    "ERROR_EE": "washer_ee", "ERROR_LOE": "washer_loe", "ERROR_LE1": "washer_le1",
    "ERROR_E3": "washer_e3", "ERROR_PS": "washer_ps", "ERROR_DE1": "washer_de1",
}

DRYER_ERROR_VALUES: Final = {
    "NONE": "no_error", "ERROR_TE1": "dryer_te1", "ERROR_TE2": "dryer_te2",
    "ERROR_TE3": "dryer_te3", "ERROR_TE4": "dryer_te4", "ERROR_TE5": "dryer_te5",
    "ERROR_TE6": "dryer_te6", "ERROR_CE1": "dryer_ce1", "ERROR_CE2": "dryer_ce2",
    "ERROR_HE1": "dryer_he1", "ERROR_E1": "dryer_e1", "ERROR_E3": "dryer_e3",
    "ERROR_E4": "dryer_e4", "ERROR_E5": "dryer_e5", "ERROR_DRAINMOTOR": "dryer_drain_motor",
    "ERROR_EMPTYWATER": "dryer_empty_water", "ERROR_DOOR": "dryer_door",
    "ERROR_FILTERCLOGGING": "dryer_filter_clogging", "ERROR_NOFILTER": "dryer_no_filter",
    "ERROR_EEPROM": "dryer_eeprom", "ERROR_F1": "dryer_f1",
}

WASHER_ERROR_OPTIONS: Final = tuple(dict.fromkeys((
    "waiting_for_data", "no_error", "unknown_error", *WASHER_ERROR_VALUES.values(),
)))
DRYER_ERROR_OPTIONS: Final = tuple(dict.fromkeys((
    "waiting_for_data", "no_error", "unknown_error", *DRYER_ERROR_VALUES.values(),
)))
DISHWASHER_ERROR_OPTIONS: Final = (
    "waiting_for_data", "no_error", "device_error", "power_failure", "unknown_error",
)
DEHUMIDIFIER_ERROR_OPTIONS: Final = (
    "waiting_for_data", "no_error", "water_tank_full", "unknown_error",
)
AIR_CONDITIONER_ERROR_OPTIONS: Final = (
    "waiting_for_data", "no_error", "air_conditioner_error", "unknown_error",
)

DEVICES: Final = {
    "dishwasher": ("식기세척기", "H01"),
    "washer": ("워시타워 세탁기", "WTL_KPK_BDH_KR_01"),
    "dryer": ("워시타워 건조기", "WTL_KPK_BDH_KR_01"),
    "dehumidifier": ("제습기", "DHUM_056905_WW"),
    "refrigerator": ("냉장고", "2REF11EBIVPC4"),
    "stick_cleaner": ("스틱청소기", "HWWA9XC_F2U"),
    "living_room_air_conditioner": ("거실 에어컨", "PAC_910604_WW"),
    "bedroom_air_conditioner": ("안방 에어컨", "RAC_056905_WW"),
}


def _description(*, device_key: str, **kwargs) -> RethinkSensorDescription:
    name, model = DEVICES[device_key]
    return RethinkSensorDescription(device_key=device_key, device_name=name, device_model=model, **kwargs)


SENSORS: Final = (
    _description(
        device_key="dishwasher", key="dishwasher_current_state", translation_key="dishwasher_current_state",
        device_class=SensorDeviceClass.ENUM, legacy_unique_id="87624224-726e-11d7-91ca-2028bcd3177e-state",
        target_entity_id="sensor.lg_dishwasher_state",
        topic=f"{MQTT_PREFIX}/87624224-726e-11d7-91ca-2028bcd3177e/state",
        options=tuple(DISHWASHER_VALUES.values()), value_map=DISHWASHER_VALUES,
    ),
    _description(
        device_key="washer", key="washer_current_state", translation_key="washer_current_state",
        device_class=SensorDeviceClass.ENUM,
        legacy_unique_id="353b81b8-37fa-1e9b-a09a-1c3929a124c9-washer-state",
        target_entity_id="sensor.lg_washtower_washer_state",
        topic=f"{MQTT_PREFIX}/353b81b8-37fa-1e9b-a09a-1c3929a124c9/washer/state",
        options=tuple(WASHER_VALUES.values()), value_map=WASHER_VALUES,
    ),
    _description(
        device_key="dryer", key="dryer_current_state", translation_key="dryer_current_state",
        device_class=SensorDeviceClass.ENUM,
        legacy_unique_id="353b81b8-37fa-1e9b-a09a-1c3929a124c9-dryer-state",
        target_entity_id="sensor.lg_washtower_dryer_state",
        topic=f"{MQTT_PREFIX}/353b81b8-37fa-1e9b-a09a-1c3929a124c9/dryer/state",
        options=tuple(DRYER_VALUES.values()), value_map=DRYER_VALUES,
    ),
    _description(
        device_key="washer", key="washer_error_message", translation_key="error_message",
        device_class=SensorDeviceClass.ENUM, entity_category=EntityCategory.DIAGNOSTIC,
        legacy_unique_id="353b81b8-37fa-1e9b-a09a-1c3929a124c9-washer-error",
        target_entity_id="sensor.lg_washtower_washer_error",
        topic=f"{MQTT_PREFIX}/353b81b8-37fa-1e9b-a09a-1c3929a124c9/washer/error",
        options=WASHER_ERROR_OPTIONS, value_map=WASHER_ERROR_VALUES,
    ),
    _description(
        device_key="dryer", key="dryer_error_message", translation_key="error_message",
        device_class=SensorDeviceClass.ENUM, entity_category=EntityCategory.DIAGNOSTIC,
        legacy_unique_id="353b81b8-37fa-1e9b-a09a-1c3929a124c9-dryer-error",
        target_entity_id="sensor.lg_washtower_dryer_error",
        topic=f"{MQTT_PREFIX}/353b81b8-37fa-1e9b-a09a-1c3929a124c9/dryer/error",
        options=DRYER_ERROR_OPTIONS, value_map=DRYER_ERROR_VALUES,
    ),
    _description(
        device_key="dishwasher", key="dishwasher_error_message", translation_key="error_message",
        device_class=SensorDeviceClass.ENUM, entity_category=EntityCategory.DIAGNOSTIC,
        target_entity_id="sensor.lg_dishwasher_error_message",
        topic=f"{MQTT_PREFIX}/87624224-726e-11d7-91ca-2028bcd3177e/state",
        options=DISHWASHER_ERROR_OPTIONS,
        value_map={**{value: "no_error" for value in DISHWASHER_VALUES if value not in ("ERROR", "POWER_FAIL")},
                   "ERROR": "device_error", "POWER_FAIL": "power_failure"},
    ),
    _description(
        device_key="dehumidifier", key="dehumidifier_error_message", translation_key="error_message",
        device_class=SensorDeviceClass.ENUM, entity_category=EntityCategory.DIAGNOSTIC,
        target_entity_id="sensor.lg_dehumidifier_error_message",
        topic=f"{MQTT_PREFIX}/d47b1abc-2275-1cfd-8fc5-d48d26f6f9fe/water_tank_full",
        options=DEHUMIDIFIER_ERROR_OPTIONS, value_map={"OFF": "no_error", "ON": "water_tank_full"},
    ),
    _description(
        device_key="refrigerator", key="refrigerator_error_message", translation_key="error_message",
        device_class=SensorDeviceClass.ENUM, entity_category=EntityCategory.DIAGNOSTIC,
        target_entity_id="sensor.lg_refrigerator_error_message", topic=None, options=("not_supported",),
        value_map={}, default_value="not_supported",
    ),
    _description(
        device_key="stick_cleaner", key="stick_cleaner_error_message", translation_key="error_message",
        device_class=SensorDeviceClass.ENUM, entity_category=EntityCategory.DIAGNOSTIC,
        target_entity_id="sensor.lg_stick_cleaner_error_message", topic=None, options=("not_supported",),
        value_map={}, default_value="not_supported",
    ),
    _description(
        device_key="living_room_air_conditioner", key="living_room_air_conditioner_error_message",
        translation_key="error_message", device_class=SensorDeviceClass.ENUM,
        entity_category=EntityCategory.DIAGNOSTIC,
        target_entity_id="sensor.lg_living_room_air_conditioner_error_message",
        topic=f"{MQTT_PREFIX}/84acfb43-68b0-1614-967c-b8165fcf1dde/error-",
        options=AIR_CONDITIONER_ERROR_OPTIONS,
        value_map={"0": "no_error"}, unknown_value="air_conditioner_error",
    ),
    _description(
        device_key="bedroom_air_conditioner", key="bedroom_air_conditioner_error_message",
        translation_key="error_message", device_class=SensorDeviceClass.ENUM,
        entity_category=EntityCategory.DIAGNOSTIC,
        target_entity_id="sensor.lg_bedroom_air_conditioner_error_message",
        topic=f"{MQTT_PREFIX}/d08cbf08-6947-1941-a24a-b8165fce8a32/error-",
        options=AIR_CONDITIONER_ERROR_OPTIONS,
        value_map={"0": "no_error"}, unknown_value="air_conditioner_error",
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up translated state and error-message sensors."""
    registry = er.async_get(hass)
    for description in SENSORS:
        if description.legacy_unique_id and (
            legacy_entity_id := registry.async_get_entity_id(
                "sensor", mqtt.DOMAIN, description.legacy_unique_id
            )
        ):
            registry.async_remove(legacy_entity_id)
    async_add_entities(RethinkSensor(description) for description in SENSORS)


class RethinkSensor(SensorEntity):
    """Rethink sensor with English native state and Korean frontend translation."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, description: RethinkSensorDescription) -> None:
        self.entity_description = description
        self._attr_unique_id = f"rethink-{description.key}"
        self._attr_options = list(description.options)
        self._attr_native_value = description.default_value
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, description.device_key)},
            name=description.device_name,
            manufacturer="LG Electronics",
            model=description.device_model,
        )
        self._attr_extra_state_attributes = None

    async def async_added_to_hass(self) -> None:
        """Keep the stable entity ID and subscribe to the raw Rethink topic."""
        await super().async_added_to_hass()
        registry = er.async_get(self.hass)
        if registry.async_get(self.entity_id):
            registry.async_update_entity(
                self.entity_id,
                new_entity_id=self.entity_description.target_entity_id,
            )
        if self.entity_description.topic:
            self.async_on_remove(
                await mqtt.async_subscribe(
                    self.hass, self.entity_description.topic, self._message_received, qos=0
                )
            )

    @callback
    def _message_received(self, message: mqtt.ReceiveMessage) -> None:
        raw = str(message.payload)
        self._attr_native_value = self.entity_description.value_map.get(
            raw, self.entity_description.unknown_value
        )
        self._attr_extra_state_attributes = {"source_value": raw}
        self.async_write_ha_state()
