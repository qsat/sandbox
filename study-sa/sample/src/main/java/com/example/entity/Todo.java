package com.example.entity;

import java.sql.Timestamp;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.SequenceGenerator;
import javax.persistence.Table;

@Entity
@Table(name = "TODOS")
public class Todo {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "TODOS_ID_SEQ")
    @SequenceGenerator(name = "TODOS_ID_SEQ", sequenceName = "TODOS_ID_SEQ", allocationSize = 1)
    @Column(name = "ID")
    public Long id;

    @Column(name = "USER_ID", nullable = false)
    public Long userId;

    @Column(name = "TITLE", nullable = false)
    public String title;

    @Column(name = "COMPLETED")
    public Integer completed = 0;

    @Column(name = "CREATED_AT")
    public Timestamp createdAt;
}
