package com.example.entity;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.SequenceGenerator;
import javax.persistence.Table;

@Entity
@Table(name = "USERS")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "USERS_ID_SEQ")
    @SequenceGenerator(name = "USERS_ID_SEQ", sequenceName = "USERS_ID_SEQ", allocationSize = 1)
    @Column(name = "ID")
    public Long id;

    @Column(name = "USERNAME", nullable = false)
    public String username;

    @Column(name = "PASSWORD", nullable = false)
    public String password;
}
