-- ユーザー (1 章の User) の保管先。Spring Security 標準の users / authorities とは別に、自前で定義する。
-- password には PasswordEncoder (DelegatingPasswordEncoder) が作った "{bcrypt}..." 形式のハッシュを入れる。
CREATE TABLE app_user (
    username varchar(100) NOT NULL,
    password varchar(200) NOT NULL,
    enabled boolean NOT NULL DEFAULT TRUE,
    PRIMARY KEY (username)
);

CREATE TABLE app_user_role (
    username varchar(100) NOT NULL,
    role varchar(50) NOT NULL,
    PRIMARY KEY (username, role),
    FOREIGN KEY (username) REFERENCES app_user (username)
);
