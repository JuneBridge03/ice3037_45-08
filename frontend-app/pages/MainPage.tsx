import { useEffect } from 'react';
import { useUserStore } from '../hooks/userStore';
import { useState } from 'react';
import { updateUserGPS, updateUserStatus } from '../utils/supabase';
import { useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import * as Linking from 'expo-linking';
import { BleManager } from 'react-native-ble-plx';
import { CHAR_UUID, EMERGENCY_PHONE, SERVICE_UUID } from '../config';
import { Alert, TouchableOpacity } from 'react-native';
import { Image, StyleSheet, Text, View, SafeAreaView } from "react-native";
import logo from '../assets/Logo.png';
import { decode as atob } from 'base-64';

type BLE_STATE = "로딩 중" | "켜짐" | "꺼짐";

export default function MainPage() {
  const { user } = useUserStore();
  const [ bleState, setBleState ] = useState<BLE_STATE>("꺼짐");
  const [isTempSafe, setIsTempSafe] = useState<boolean>(true);
  const [isHeartRateSafe, setIsHeartRateSafe] = useState<boolean>(true);
  const [isFallSafe, setIsFallSafe] = useState<boolean>(true);

  const [ recentBuffer, setRecentBuffer ] = useState<Uint8Array | null>(null);

  const navigate = useNavigation();

  useEffect(() => {
    if (!user) {
      navigate.navigate('IntroPage' as never);
      return;
    }
  }, [user]);

  useEffect(() => { // 체온
    if (!user) return;
    updateUserStatus(user.id, isTempSafe);
  }, [isTempSafe]);

  useEffect(() => { // 심박수, 넘어짐
    if (isHeartRateSafe && isFallSafe) return;
    Alert.alert(
      "긴급 상황이십니까?",
      "긴급 상황이시라면 전화를 걸어주세요.",
      [
        {
          text: "네",
          onPress: () => {
            Linking.canOpenURL(`tel:${EMERGENCY_PHONE}`)
              .then((supported: boolean) => {
                if (!supported) {
                  Alert.alert('통화 기능을 사용할 수 없습니다.');
                } else {
                  return Linking.openURL(`tel:${EMERGENCY_PHONE}`);
                }
              })
              .catch((err: Error) => Alert.alert('전화 연결 에러:' + err.name, err.message));
          }
        },
        {
          text: "아니오",
          onPress: () => { }
        }
      ],
      { cancelable: true }
    );
  }, [isHeartRateSafe, isFallSafe]);

  useEffect(() => { // GPS
    if (!user) return;
    let subscriber: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('위치 권한 거부됨');
        return;
      }

      // 위치 변경을 감지해서 setCoords 호출
      subscriber = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Highest,
          timeInterval: 1000,    // 최소 1초마다
          distanceInterval: 1,   // 최소 1미터 이동 시
        },
        location => {
          updateUserGPS(user.id, location.coords.latitude, location.coords.longitude);
        }
      );
    })();

    return () => {
      // 컴포넌트 언마운트 시 구독 해제
      subscriber && subscriber.remove();
    };
  }, [user]);

  useEffect(() => { // 블루투스
    const manager = new BleManager();
    let subState;

    subState = manager.onStateChange(state => {
      if (state === 'PoweredOn') {
        setBleState("로딩 중");
        manager.startDeviceScan([SERVICE_UUID], {}, (error, device) => {
          if (error) {
            Alert.alert('블루투스 연결 에러 1 ' + error.errorCode, error.message);
            return;
          }
          manager.stopDeviceScan();
          setBleState("켜짐");
          if (!device) {
            setBleState("꺼짐");
            return;
          }
          device.connect()
            .then(d => d.discoverAllServicesAndCharacteristics())
            .catch(
              (error: Error) => {
                Alert.alert("블루투스 연결 에러 2 " + error.name, error.message)
                return null;
              }
            )
            .then(d => {
              if (!d) return;
              d.monitorCharacteristicForService(
                SERVICE_UUID,
                CHAR_UUID,
                (error, c) => {
                  if (error) {
                    Alert.alert('블루투스 연결 에러 ' + error.errorCode, error.message);
                    return;
                  }
                  if (!c) return;
                  if (!c.value) return;
                  const binary = atob(c.value);
                  const bytes = Uint8Array.from(binary, (char: string) => char.charCodeAt(0));
                  setRecentBuffer(bytes);

                  // 2) 프레임 헤더/테일 검사
                  if (
                    bytes.length === 3           // 최소 길이(헤더+3바이트+테일)
                  ) {
                    // 3) 실제 데이터(3바이트) 추출
                    const payload = bytes; // Uint8Array [b0, b1, b2]
                    setIsTempSafe(payload[0] === 1);
                    setIsHeartRateSafe(payload[1] === 1);
                    setIsFallSafe(payload[2] === 1);
                  }
                }
              )
            }
            ).catch(
              (error: Error) => {
                Alert.alert("블루투스 수신 에러 " + error.name, error.message)
              }
            );
        });
      }
    }, true);

    return () => {
      subState.remove();
      manager.stopDeviceScan();
      manager.destroy();
      setBleState("꺼짐");
    };

  }, []);

  return (
    <SafeAreaView style={[styles.safeareaview, styles.parentFlexBox]}>
      <View style={styles.image1Parent}>
        <Image style={styles.image1Icon} resizeMode="cover" source={logo} />
        <Text style={styles.text}>{bleState}</Text>
      </View>
      {isTempSafe && isHeartRateSafe && isFallSafe ? <SafeLayout /> : <UnsafeLayout />}
      {recentBuffer && <Text>{recentBuffer.join(', ')}</Text>}
    </SafeAreaView>);
};


const styles = StyleSheet.create({
  parentFlexBox: {
    gap: 10,
    justifyContent: "center",
    overflow: "hidden"
  },
  textClr: {
    color: "#000",
    textAlign: "left"
  },
  image1Icon: {
    width: 110,
    height: 111
  },
  text: {
    fontWeight: "800",
    fontFamily: "Inter-ExtraBold",
    color: "#46a653",
    textAlign: "left",
    fontSize: 29
  },
  image1Parent: {
    flexDirection: "row",
    paddingHorizontal: 30,
    paddingVertical: 0,
    justifyContent: "center",
    overflow: "hidden",
    alignItems: "center"
  },
  text1: {
    fontWeight: "900",
    fontFamily: "Inter-Black",
    fontSize: 29,
    color: "#000"
  },
  text2: {
    fontSize: 18,
    fontWeight: "500",
    fontFamily: "Inter-Medium"
  },
  parent: {
    alignSelf: "stretch",
    borderRadius: 10,
    backgroundColor: "#d7ffb8",
    paddingHorizontal: 20,
    paddingVertical: 10
  },
  safeareaview: {
    backgroundColor: "#fff",
    flex: 1,
    width: "100%",
    height: 568,
    paddingHorizontal: 10,
    paddingVertical: 187,
    alignItems: "center",
    gap: 10
  }
});

const SafeLayout = () => {
  return (
    <View style={[styles.parent, styles.parentFlexBox]}>
      <Text style={[styles.text1, styles.textClr]}>안전</Text>
      <Text style={[styles.text2, styles.textClr]}>{`현재는 안전한 상태입니다
안전하게 농업 생활하시길 바랍니다`}</Text>
    </View>
  )
}

const UnsafeLayout = () => {
  return (
    <View style={[styles.parent, styles.parentFlexBox, { backgroundColor: "#ffb8d1" }]}>
      <Text style={[styles.text1, styles.textClr]}>위험</Text>
      <Text style={[styles.text2, styles.textClr]}>{`현재는 위험한 상태입니다
위험한 상황을 피하는 것이 좋습니다`}</Text>
    </View>
  )
}