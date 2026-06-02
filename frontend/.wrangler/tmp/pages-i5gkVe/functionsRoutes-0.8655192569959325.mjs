import { onRequest as __api___path___js_onRequest } from "C:\\ChumiApp\\frontend\\functions\\api\\[[path]].js"
import { onRequestPost as __bot_js_onRequestPost } from "C:\\ChumiApp\\frontend\\functions\\bot.js"

export const routes = [
    {
      routePath: "/api/:path*",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api___path___js_onRequest],
    },
  {
      routePath: "/bot",
      mountPath: "/",
      method: "POST",
      middlewares: [],
      modules: [__bot_js_onRequestPost],
    },
  ]