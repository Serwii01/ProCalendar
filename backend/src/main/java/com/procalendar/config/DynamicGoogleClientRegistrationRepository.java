package com.procalendar.config;

import com.procalendar.settings.SettingsService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.ClientRegistrations;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Builds the Google ClientRegistration on the fly from SettingsService.
 * This makes it possible to configure / change Google credentials from the
 * desktop client at runtime, without restarting Spring or editing files.
 */
@Component
public class DynamicGoogleClientRegistrationRepository implements ClientRegistrationRepository {

    private final SettingsService settings;

    @Value("${spring.security.oauth2.client.registration.google.client-id:}")
    private String fallbackClientId;
    @Value("${spring.security.oauth2.client.registration.google.client-secret:}")
    private String fallbackClientSecret;

    private static final List<String> SCOPES = List.of(
            "openid", "profile", "email",
            "https://www.googleapis.com/auth/calendar"
    );
 
    public DynamicGoogleClientRegistrationRepository(SettingsService settings) {
        this.settings = settings;
    }

    @Override
    public ClientRegistration findByRegistrationId(String registrationId) {
        if (!"google".equals(registrationId)) return null;

        String clientId     = settings.get(SettingsService.GOOGLE_CLIENT_ID, fallbackClientId);
        String clientSecret = settings.get(SettingsService.GOOGLE_CLIENT_SECRET, fallbackClientSecret);
        if (clientId == null || clientId.isBlank()) {
            // Return a stub so Spring doesn't crash; OAuth flow will fail at use time.
            clientId = "unconfigured";
            clientSecret = "unconfigured";
        }
        return ClientRegistration.withRegistrationId("google")
                .clientId(clientId)
                .clientSecret(clientSecret)
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
                .scope(SCOPES)
                .authorizationUri("https://accounts.google.com/o/oauth2/v2/auth")
                .tokenUri("https://www.googleapis.com/oauth2/v4/token")
                .userInfoUri("https://www.googleapis.com/oauth2/v3/userinfo")
                .userNameAttributeName("sub")
                .jwkSetUri("https://www.googleapis.com/oauth2/v3/certs")
                .clientName("Google")
                .build();
    }
}
