package com.procalendar;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class ProCalendarApplication {
  public static void main(String[] args) { SpringApplication.run(ProCalendarApplication.class, args); }
}
