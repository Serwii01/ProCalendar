package com.procalendar.event;

import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/events")
@CrossOrigin(origins = "*")
public class CalendarEventController {

  private final CalendarEventRepository repository;

  public CalendarEventController(CalendarEventRepository repository) {
    this.repository = repository;
  }

  @GetMapping
  public List<CalendarEvent> all() {
    return repository.findAll();
  }

  @PostMapping
  public CalendarEvent create(@RequestBody CalendarEvent event) {
    return repository.save(event);
  }

  @DeleteMapping("/{id}")
  public void delete(@PathVariable Long id) {
    repository.deleteById(id);
  }
}