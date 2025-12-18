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
import type {RegisteredFacesDTO} from "./dto/DlxTypes";
import {faceIdMappingStorage, userInfoCacheStorage} from "./comm/GlobalStorage";




const RegisterFaces = ({navigation}) => {
  const [faces, setFaces] = useState<RegisteredFacesDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 加载所有已注册的人脸信息
    const loadRegisteredFaces = () => {
      setLoading(true);
      try {
        const registeredUserNames = faceIdMappingStorage.getAllKeys();
        const faceData: RegisteredFacesDTO[] = [];

        for (const userName of registeredUserNames) {
          const userInfoString = userInfoCacheStorage.getString(userName);
          const faceId = faceIdMappingStorage.getNumber(userName);

          if (userInfoString && faceId) {
            const userInfo = JSON.parse(userInfoString);
            faceData.push({
              id: userName,
              faceId: faceId,
              name: userInfo.name,
              imageUrl: userInfo.imageUrl,
            });
          }
        }
        setFaces(faceData);
      } catch (error) {
        console.error('加载已注册人脸信息失败:', error);
      } finally {
        setLoading(false);
      }
    };

    loadRegisteredFaces();
  }, []);

  const renderItem = ({ item }: { item: RegisteredFace }) => (
    <View style={styles.card}>
      <Image
        source={{ uri: item.imageUrl || 'https://via.placeholder.com/100' }}
        style={styles.image}
        resizeMode="cover"
      />
      <View style={styles.infoContainer}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.idText}>Hub ID: {item.hubId}</Text>
        <Text style={styles.idText}>User Tag: {item.id}</Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
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
          keyExtractor={(item) => item.id}
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
