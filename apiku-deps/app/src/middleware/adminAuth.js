export default function adminAuth(req, res, next) {
  if (req.session && req.session.adminLoggedIn === true) {
    return next();
  }
  return res.status(401).json({
    success: false,
    error: "Unauthorized",
    message: "Admin login required",
  });
}

export function adminAuthPage(req, res, next) {
  if (req.session && req.session.adminLoggedIn === true) {
    return next();
  }
  if (req.accepts("html")) {
    return res.redirect("/admin/login");
  }
  return res.status(401).json({
    success: false,
    error: "Unauthorized",
    message: "Admin login required",
  });
}
