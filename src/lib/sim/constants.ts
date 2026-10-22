// Names shared by the simulated realm (server) and the simulated session (browser).

export const SIM_REALM = "errand";
export const SIM_CLIENT_ID = "errand-client";
export const SIM_VENDOR_ID = "sim-vendor-errand";

/** Browser path of the simulated TideCloak; the server's issuer is configured separately. */
export const SIM_TIDECLOAK_PATH = "/sim-tidecloak";
export const SIM_TOKEN_PATH = `${SIM_TIDECLOAK_PATH}/realms/${SIM_REALM}/protocol/openid-connect/token`;
export const SIM_LOGOUT_PATH = `${SIM_TIDECLOAK_PATH}/realms/${SIM_REALM}/protocol/openid-connect/logout`;
export const SIM_LOGIN_PAGE = `${SIM_TIDECLOAK_PATH}/login`;
