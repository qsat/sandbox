
# プロジェクト雛形作成

## ダウンロード

```
curl -O http://maven.seasar.org/maven2/org/seasar/sastruts/sa-struts-archetype/1.0.4-sp9.1/sa-struts-archetype-1.0.4-sp9.1.jar
```


## POMファイルも一緒にインストール
```
mvn install:install-file \
  -Dfile=sa-struts-archetype-1.0.4-sp9.1.jar \
  -DgroupId=org.seasar.sastruts \
  -DartifactId=sa-struts-archetype \
  -Dversion=1.0.4-sp9.1 \
  -Dpackaging=jar \
  -DgeneratePom=true
```

## 生成
```
mvn org.apache.maven.plugins:maven-archetype-plugin:2.4:generate \
  -DarchetypeGroupId=org.seasar.sastruts \
  -DarchetypeArtifactId=sa-struts-archetype \
  -DarchetypeVersion=1.0.4-sp9.1 \
  -DarchetypeCatalog=local \
  -DgroupId=com.example \
  -DartifactId=sample \
  -Dversion=1.0 \
  -DinteractiveMode=false
```
