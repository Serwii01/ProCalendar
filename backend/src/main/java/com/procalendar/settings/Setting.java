package com.procalendar.settings;

import jakarta.persistence.*;

/** Key/value settings store. Runtime configuration editable from the desktop client. */
@Entity
@Table(name = "app_setting")
public class Setting {

    @Id
    @Column(name = "setting_key", length = 80)
    private String key;

    @Column(name = "setting_value", length = 2000)
    private String value;

    public Setting() {}
    public Setting(String key, String value) { this.key = key; this.value = value; }

    public String getKey() { return key; }
    public void setKey(String key) { this.key = key; }
    public String getValue() { return value; }
    public void setValue(String value) { this.value = value; }
}
