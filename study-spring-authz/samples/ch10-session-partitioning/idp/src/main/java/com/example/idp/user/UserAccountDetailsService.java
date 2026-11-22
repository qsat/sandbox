package com.example.idp.user;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsPasswordService;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

/**
 * ログイン時にユーザーを引く。
 *
 * <p>UserDetailsPasswordService も実装しておくと、ログインに成功した瞬間に
 * 古い形式のハッシュを現在の形式 ({bcrypt}) に自動で書き換えられる (ハッシュの移行)。
 * 平文のパスワードが手元にあるのはログイン時だけなので、この場面でしか移行できない。
 */
@Service
public class UserAccountDetailsService implements UserDetailsService, UserDetailsPasswordService {

    private final UserAccountRepository repository;

    public UserAccountDetailsService(UserAccountRepository repository) {
        this.repository = repository;
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        return repository.findByUsername(username)
            .map(UserAccountDetails::new)
            .orElseThrow(() -> new UsernameNotFoundException("user not found: " + username));
    }

    @Override
    public UserDetails updatePassword(UserDetails user, String newPassword) {
        UserAccount updated = repository.findByUsername(user.getUsername())
            .orElseThrow(() -> new UsernameNotFoundException("user not found: " + user.getUsername()))
            .withPasswordHash(newPassword);
        repository.save(updated);
        return new UserAccountDetails(updated);
    }
}
