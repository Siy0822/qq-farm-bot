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
const { registerAdminHonghuaActivityRoutes } = require('./admin-honghua-activity-routes');
const { registerAdminAutumnActivityRoutes } = require('./admin-autumn-activity-routes');
const { registerAdminPetDiaryRoutes } = require('./admin-pet-diary-activity-routes');

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
  registerAdminHonghuaActivityRoutes(routeContext);
  registerAdminAutumnActivityRoutes(routeContext);
  registerAdminPetDiaryRoutes(routeContext);
}

module.exports = { registerAdminActivityRoutes };
