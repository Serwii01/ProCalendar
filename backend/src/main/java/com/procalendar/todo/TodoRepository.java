package com.procalendar.todo;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TodoRepository extends JpaRepository<Todo, Long> {

    List<Todo> findAllByOrderByDoneAscPriorityDescDueAtAsc();

    List<Todo> findByDoneOrderByPriorityDescDueAtAsc(boolean done);
}
