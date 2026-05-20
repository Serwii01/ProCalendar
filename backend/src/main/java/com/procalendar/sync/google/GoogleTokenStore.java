package com.procalendar.sync.google;

import org.springframework.stereotype.Component;

@Component
public class GoogleTokenStore {

    private String accessToken;
    private String refreshToken;

    public void save(String accessToken, String refreshToken) {
        this.accessToken  = accessToken;
        this.refreshToken = refreshToken;
    }

    public String getAccessToken()  { return accessToken; }
    public String getRefreshToken() { return refreshToken; }
    public boolean hasToken()       { return accessToken != null && !accessToken.isBlank(); }
    public void clear()             { this.accessToken = null; this.refreshToken = null; }
}