// 管理后台页面：HTML 独立文件（wrangler Text rule 导入），避免模板字符串转义
import ADMIN_HTML from "./admin.html";
export function adminPage() {
  return new Response(ADMIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
