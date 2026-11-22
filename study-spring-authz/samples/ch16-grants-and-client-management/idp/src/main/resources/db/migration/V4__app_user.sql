-- ユーザー (1 章の User) の保管先。列は 6 章の UserAccount の属性とそのまま対応する。
-- 7 章の app_user (username / password / enabled + app_user_role) は、UserAccount に合わせて作り直した。
-- password_hash には PasswordEncoder (DelegatingPasswordEncoder) が作った "{bcrypt}..." 形式のハッシュを入れる。
CREATE TABLE app_user (
    id varchar(100) NOT NULL,
    username varchar(100) NOT NULL,
    password_hash varchar(200) NOT NULL,
    display_name varchar(200) NOT NULL,
    email varchar(320) NOT NULL,
    email_verified boolean NOT NULL DEFAULT FALSE,
    enabled boolean NOT NULL DEFAULT TRUE,
    PRIMARY KEY (id),
    -- ログイン名で引くので一意にする (変更は許すが、重複は許さない)
    CONSTRAINT uq_app_user_username UNIQUE (username)
);
