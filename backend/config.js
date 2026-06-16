require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 2000,

  EDI_BASE_URL: process.env.EDI_BASE_URL,
  EDI_HOST: process.env.EDI_HOST,
  EDI_COMP_CODE: process.env.EDI_COMP_CODE,
  EDI_USERNAME: process.env.EDI_USERNAME,
  EDI_PASSWORD: process.env.EDI_PASSWORD,
  EDI_USER_COOKIE: process.env.EDI_USER_COOKIE,
  EDI_COMP_COOKIE: process.env.EDI_COMP_COOKIE,

  MONITORING_FORM_DIR: process.env.MONITORING_FORM_DIR,
};