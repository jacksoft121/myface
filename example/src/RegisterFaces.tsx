import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  SafeAreaView,
  ActivityIndicator,
  Button,
} from 'react-native';
import type { RegisteredFacesDTO } from "./dto/DlxTypes";
import {debugGetAllRawData, diagnosticTest, getAllUsers} from "./comm/FaceDB";

const RegisterFaces = ({ navigation }) => {
  const [faces, setFaces] = useState<RegisteredFacesDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 加载所有已注册的人脸信息
    const loadRegisteredFaces = async () => {
      setLoading(true);
      try {
        // 从 FaceDB 获取所有用户数据

        const users = await getAllUsers();
        console.log('从数据库获取到的用户数据:', users); // 添加调试日志

        const faceData: RegisteredFacesDTO[] = users.map(user => ({
          id: user.id, // 使用 dlx_user_id 作为 id
          faceId: user.id, // 使用数据库中的 id 作为 faceId
          userId: user.dlx_user_id || '', // 使用 dlx_user_id 作为 userId
          name: user.name,
          imageUrl: user.dlx_user_oss_url || '', // 如果有 OSS URL 则使用，否则为空
          role: user.dlx_user_role || '', // 如果有角色信息则使用，否则为空
        }));

        console.log('转换后的 faceData:', faceData); // 添加调试日志
        setFaces(faceData);
      } catch (error) {
        console.error('加载已注册人脸信息失败:', error);
      } finally {
        setLoading(false);
      }
    };

    loadRegisteredFaces();
  }, []);

  const renderItem = ({ item }: { item: RegisteredFacesDTO }) => (
    <View style={styles.card}>
      <Image
        source={{ uri: item.imageUrl || 'https://via.placeholder.com/100' }}
        style={styles.image}
        resizeMode="cover"
      />
      <View style={styles.infoContainer}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.idText}>Hub ID: {item.faceId}</Text>
        <Text style={styles.idText}>User Tag: {item.id}</Text>
        {item.role ? <Text style={styles.idText}>Role: {item.role}</Text> : null}
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 10 }}>加载中...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Button title="注册" onPress={() => navigation.navigate('Apptest')} />
      {faces.length === 0 ? (
        <View style={styles.centered}>
          <Text>没有已注册的人脸信息</Text>
        </View>
      ) : (
        <FlatList
          data={faces}
          renderItem={renderItem}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    padding: 10,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
    alignItems: 'center',
  },
  image: {
    width: 80,
    height: 80,
    borderRadius: 40, // 圆形图片
    marginRight: 15,
    backgroundColor: '#e0e0e0',
  },
  infoContainer: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  idText: {
    fontSize: 14,
    color: '#666',
  },
});

export default RegisterFaces;
