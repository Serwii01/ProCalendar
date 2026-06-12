package com.procalendar.config;

import com.procalendar.sync.google.GoogleTokenStore;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.web.authentication.SimpleUrlAuthenticationSuccessHandler;

import java.io.IOException;

public class GoogleOAuthSuccessHandler extends SimpleUrlAuthenticationSuccessHandler {

    private final GoogleTokenStore tokenStore;

    // Spring lo inyecta automáticamente via contexto
    @org.springframework.beans.factory.annotation.Autowired
    private OAuth2AuthorizedClientService clientService;

    public GoogleOAuthSuccessHandler(GoogleTokenStore tokenStore) {
        this.tokenStore = tokenStore;
    }

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request,
                                        HttpServletResponse response,
                                        Authentication authentication) throws IOException {

        OAuth2AuthenticationToken oauthToken = (OAuth2AuthenticationToken) authentication;

        OAuth2AuthorizedClient client = clientService.loadAuthorizedClient(
                oauthToken.getAuthorizedClientRegistrationId(),
                oauthToken.getName()
        );

        if (client != null) {
            String access  = client.getAccessToken().getTokenValue();
            String refresh = client.getRefreshToken() != null
                    ? client.getRefreshToken().getTokenValue()
                    : null;
            java.time.Instant expiresAt = client.getAccessToken().getExpiresAt() != null
                    ? client.getAccessToken().getExpiresAt()
                    : java.time.Instant.now().plusSeconds(3000);
            tokenStore.save(access, refresh, expiresAt);
        }

        // Redirige a una página de confirmación simple
        response.sendRedirect("/api/sync/oauth-done");
    }
}