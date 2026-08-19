// 农场小程序 OpenAuth action —— 构建期注入 napcat.mjs 的模板。
//
// 以「命名类表达式」形式提供，由 apply-farm-patch.mjs 包成
//   new (<本模板>)(obContext, core),
// 直接插进 NapCat 的 action 注册数组首位。这样无需在压缩代码里寻找顶层作用域
// 插入点，语法上天然安全。
//
// 占位符由 apply-farm-patch.mjs 从目标文件动态推导后替换：
//   __BASE__     OneBot action 基类
//   __ACTIONS__  action 名称枚举对象
//   __SCHEMA__   typebox schema 构造器别名
//   __CLASS__    注入类名
class __CLASS__ extends __BASE__ {
  actionName = __ACTIONS__.StartMiniApp1112386029;
  payloadSchema = __SCHEMA__.Object({
    path: __SCHEMA__.Optional(__SCHEMA__.String({ description: "小程序启动路径或参数" })),
    link: __SCHEMA__.Optional(__SCHEMA__.String({ description: "小程序链接" })),
    app_id: __SCHEMA__.Optional(__SCHEMA__.String({ description: "小程序 AppID" })),
    app_type: __SCHEMA__.Optional(__SCHEMA__.Any({ description: "小程序类型" })),
    appid_token: __SCHEMA__.Optional(__SCHEMA__.String({ description: "授权委托 token" })),
    param1: __SCHEMA__.Optional(__SCHEMA__.String()),
    param2: __SCHEMA__.Optional(__SCHEMA__.String()),
    auth_items: __SCHEMA__.Optional(__SCHEMA__.Any({ description: "授权项列表" })),
    extra_param: __SCHEMA__.Optional(__SCHEMA__.Any({ description: "附加参数" })),
    extra: __SCHEMA__.Optional(__SCHEMA__.Any({ description: "启动附加参数" })),
    appId: __SCHEMA__.Optional(__SCHEMA__.String({ description: "启动的小程序 AppID" }))
  });
  returnSchema = __SCHEMA__.Any({ description: "启动结果" });
  actionSummary = "启动小程序 1112386029";
  actionTags = ["系统扩展"];
  payloadExample = { path: "" };
  returnExample = {};
  async _handle(payload) {
    const svc = this.core.context.session.getNodeMiscService();
    const op = payload.path ?? "";
    const APPID = "1112386029";
    const call = async (fn) => {
      try {
        return await Promise.race([
          fn(),
          new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 30000))
        ]);
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    };
    // __inspect__ 用于新版本 NapCat 上核对 NodeMiscService 是否仍提供所需方法
    if (op === "__inspect__") {
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(svc)).filter((k) => typeof svc[k] === "function");
      const sig = (k) => ({ arity: svc[k]?.length ?? -1, source: String(svc[k] ?? "").slice(0, 1200) });
      return {
        nodeMiscMethods: methods,
        signatures: {
          loginWXMiniApp: sig("loginWXMiniApp"),
          getOpenAuth: sig("getOpenAuth"),
          getOpenCodeWithAppId: sig("getOpenCodeWithAppId"),
          loginWithAppId: sig("loginWithAppId"),
          startNewMiniApp: sig("startNewMiniApp")
        }
      };
    }
    if (op === "__open_auth__") return { operation: op, result: await call(() => svc.getOpenAuth(true, APPID)) };
    if (op === "__open_auth_path__") return { operation: op, result: await call(() => svc.getOpenAuth(false, APPID)) };
    if (op === "__open_code__") return { operation: op, result: await call(() => svc.getOpenCodeWithAppId(APPID)) };
    if (op === "__login_with_appid__") return { operation: op, result: await call(() => svc.loginWithAppId(APPID)) };
    if (op === "__login_wx_mini_app__") return { operation: op, result: await call(() => svc.loginWXMiniApp(APPID)) };
    if (op === "__check_miniapp_session__") return { operation: op, result: await call(() => svc.checkSessionForMiniApp(APPID)) };
    if (op === "__miniapp_user_info__") return { operation: op, result: await call(() => svc.getUserInfoWithAppId(APPID)) };
    if (op === "__app_launch_info__") return { operation: op, result: await call(() => svc.getAppLaunchInfo(APPID)) };
    if (op === "__app_info_by_link__") return { operation: op, result: await call(() => svc.getAppInfoByLink(String(payload.link ?? ""), Number(payload.app_type ?? 0), String(payload.app_id ?? ""), String(payload.path ?? ""), payload.extra_param ?? {})) };
    if (op === "__app_info_by_id__") return { operation: op, result: await call(() => svc.getAppInfoById(String(payload.app_id ?? APPID), String(payload.param1 ?? ""), String(payload.param2 ?? ""), payload.extra_param ?? {})) };
    if (op === "__set_miniapp_auth__") return { operation: op, result: await call(() => svc.setMiniAppAuthReq(APPID, Array.isArray(payload.auth_items) ? payload.auth_items : [])) };
    if (op === "__clear_miniapp_auth__") return { operation: op, result: await call(() => svc.clearAuthWithAppIdList([APPID])) };
    if (op === "__mini_app_auth_list__") return { operation: op, result: await call(() => svc.getMiniAppAuthList()) };
    if (op === "__mini_app_auth_result__") return { operation: op, result: await call(() => svc.getSingleMiniAppAuthResult(APPID)) };
    if (op === "__open_auth_delegate_code__") return { operation: op, result: await call(() => svc.getOpenAuthDelegateCode(APPID, String(payload.appid_token ?? ""), String(payload.app_type ?? ""))) };
    const started = await call(async () => {
      await svc.setMiniAppVersion("2.16.4");
      return svc.startNewMiniApp(payload.appId ?? APPID, payload.path ?? "", payload.extra ?? "");
    });
    return { started: true, result: started };
  }
}
