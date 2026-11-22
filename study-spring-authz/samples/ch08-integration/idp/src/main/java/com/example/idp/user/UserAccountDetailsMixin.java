package com.example.idp.user;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * {@link UserAccountDetails} を Jackson で保存・復元するための Mixin (Jackson の注釈を後付けするクラス)。
 *
 * <p>認可の attributes には、ログイン中のユーザー (Authentication の principal) が JSON で入る。
 * JDBC 実装の Jackson は型名つきで書き、読み戻すときは許可リストにある型しか復元しない。
 * 許可リストへの登録は {@link com.example.idp.config.PersistenceConfig} で行う。
 *
 * <ul>
 *   <li>フィールドの account だけを保存する。getUsername() などの導出される値は保存しない
 *       (保存すると読み戻しで「そんな設定項目は無い」と失敗する)</li>
 *   <li>復元は account を受け取るコンストラクターで行う</li>
 * </ul>
 */
@JsonAutoDetect(fieldVisibility = JsonAutoDetect.Visibility.ANY,
    getterVisibility = JsonAutoDetect.Visibility.NONE,
    isGetterVisibility = JsonAutoDetect.Visibility.NONE)
@JsonIgnoreProperties(ignoreUnknown = true)
public abstract class UserAccountDetailsMixin {

    @JsonCreator
    protected UserAccountDetailsMixin(@JsonProperty("account") UserAccount account) {
    }
}
