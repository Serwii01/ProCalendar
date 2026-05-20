package com.procalendar.todo;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/todos")
@CrossOrigin(origins = "*")
public class TodoController {

    private final TodoRepository repository;

    public TodoController(TodoRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public List<Todo> list(@RequestParam(required = false) Boolean done) {
        if (done != null) {
            return repository.findByDoneOrderByPriorityDescDueAtAsc(done);
        }
        return repository.findAllByOrderByDoneAscPriorityDescDueAtAsc();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Todo create(@Valid @RequestBody Todo todo) {
        todo.setId(null);
        todo.setCreatedAt(LocalDateTime.now());
        if (todo.getPriority() == null) todo.setPriority(Todo.Priority.MEDIUM);
        if (todo.isDone() && todo.getCompletedAt() == null) {
            todo.setCompletedAt(LocalDateTime.now());
        }
        return repository.save(todo);
    }

    @PutMapping("/{id}")
    public Todo update(@PathVariable Long id, @Valid @RequestBody Todo payload) {
        Todo existing = repository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Todo not found"));

        existing.setTitle(payload.getTitle());
        existing.setNotes(payload.getNotes());
        existing.setDueAt(payload.getDueAt());
        existing.setPriority(payload.getPriority() != null ? payload.getPriority() : existing.getPriority());

        if (payload.isDone() && !existing.isDone()) {
            existing.setCompletedAt(LocalDateTime.now());
        } else if (!payload.isDone() && existing.isDone()) {
            existing.setCompletedAt(null);
        }
        existing.setDone(payload.isDone());
        return repository.save(existing);
    }

    @PostMapping("/{id}/toggle")
    public Todo toggle(@PathVariable Long id) {
        Todo todo = repository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Todo not found"));
        todo.setDone(!todo.isDone());
        todo.setCompletedAt(todo.isDone() ? LocalDateTime.now() : null);
        return repository.save(todo);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        if (!repository.existsById(id)) return ResponseEntity.notFound().build();
        repository.deleteById(id);
        return ResponseEntity.noContent().build();
    }
}
