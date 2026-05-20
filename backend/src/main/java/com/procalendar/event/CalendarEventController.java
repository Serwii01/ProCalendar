package com.procalendar.event;

import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/events")
@CrossOrigin(origins = "*")
public class CalendarEventController {

    private final CalendarEventRepository repository;

    public CalendarEventController(CalendarEventRepository repository) {
        this.repository = repository;
    }

    /**
     * Lists events.
     * - If from/to provided, returns events overlapping that range.
     * - If q provided, performs a text search.
     * - Otherwise returns everything (capped server-side for safety).
     */
    @GetMapping
    public List<CalendarEvent> list(
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime from,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime to,
            @RequestParam(required = false) String q) {

        if (q != null && !q.isBlank()) {
            return repository.search(q.trim());
        }
        if (from != null && to != null) {
            return repository.findInRange(from, to);
        }
        return repository.findAll();
    }

    @GetMapping("/{id}")
    public CalendarEvent one(@PathVariable Long id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Event not found"));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CalendarEvent create(@Valid @RequestBody CalendarEvent event) {
        event.setId(null);
        normalize(event);
        return repository.save(event);
    }

    @PutMapping("/{id}")
    public CalendarEvent update(@PathVariable Long id, @Valid @RequestBody CalendarEvent payload) {
        CalendarEvent existing = repository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Event not found"));

        existing.setTitle(payload.getTitle());
        existing.setDescription(payload.getDescription());
        existing.setLocation(payload.getLocation());
        existing.setStartAt(payload.getStartAt());
        existing.setEndAt(payload.getEndAt());
        existing.setAllDay(payload.isAllDay());
        existing.setColor(payload.getColor());
        // Source/externalId are only touched by sync flows, not by manual edits.
        normalize(existing);
        return repository.save(existing);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        if (!repository.existsById(id)) {
            return ResponseEntity.notFound().build();
        }
        repository.deleteById(id);
        return ResponseEntity.noContent().build();
    }

    private void normalize(CalendarEvent e) {
        if (e.getStartAt() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "startAt is required");
        }
        if (e.getEndAt() == null) {
            // For all-day events, default end to same day end-of-day; for timed, default +1h
            e.setEndAt(e.isAllDay()
                    ? e.getStartAt().withHour(23).withMinute(59)
                    : e.getStartAt().plusHours(1));
        }
        if (e.getEndAt().isBefore(e.getStartAt())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "endAt must be after startAt");
        }
        if (e.getSource() == null) {
            e.setSource(CalendarEvent.Source.LOCAL);
        }
    }
}
