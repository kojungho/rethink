"""Config flow for Rethink."""

from __future__ import annotations

from typing import Any

from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlowResult

from .const import DOMAIN


class RethinkConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create the single Rethink config entry."""

    VERSION = 1

    async def async_step_import(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Import configuration.yaml setup."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title="Rethink", data={})

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Allow setup from the integrations screen."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title="Rethink", data={})
