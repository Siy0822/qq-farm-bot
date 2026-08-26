const {
  registerAdminHeluActivityRoutes,
} = require("./admin-helu-activity-routes");
const {
  registerAdminNanguaActivityRoutes,
} = require("./admin-nangua-activity-routes");
const {
  registerAdminGuanxingRoutes,
} = require("./admin-guanxing-routes");
const {
  registerAdminQixiActivityRoutes,
} = require("./admin-qixi-activity-routes");
const { registerAdminYuluActivityRoutes } = require('./admin-yulu-activity-routes');

function registerAdminActivityRoutes({
  app,
  provider,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  const routeContext = {
    app,
    provider,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  };

  registerAdminNanguaActivityRoutes(routeContext);
  registerAdminHeluActivityRoutes(routeContext);
  registerAdminGuanxingRoutes(routeContext);
  registerAdminQixiActivityRoutes(routeContext);
  registerAdminYuluActivityRoutes(routeContext);
}

module.exports = { registerAdminActivityRoutes };
