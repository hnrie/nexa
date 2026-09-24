package api

import "net/http"

// routeGroups lists every registration function. Handler files append to it
// through init-free explicit listing so the order (and the routes) stay visible.
func (s *Server) routeGroups() []func(mux *http.ServeMux) {
	return []func(mux *http.ServeMux){s.authRoutes, s.userRoutes, s.mediaRoutes, s.channelRoutes, s.messageRoutes, s.relationshipRoutes, s.keyRoutes, s.unfurlRoutes, s.serverRoutes, s.expressionRoutes, s.voiceRoutes, s.adminRoutes, s.moderationRoutes, s.nexaRoutes, s.legalRoutes, s.proxyRoutes, s.groupRoutes, s.mfaRoutes, s.subchatRoutes, s.crashRoutes, s.uploadRoutes, s.desktopRoutes, s.androidRoutes, s.activityRoutes, s.guestRoutes, s.staticRoutes}
}
