import React,{useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {API_URL} from './api';
import {Button,Card,Field,Logo,Page,colors,styles} from './ui';
export function LoginScreen({busy,onSubmit}:{busy:boolean;onSubmit:(username:string,password:string)=>void}){
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[show,setShow]=useState(false);
 const ready=!busy&&!!username.trim()&&!!password;
 const submit=()=>{if(ready){onSubmit(username.trim(),password);setPassword('');}};
 return <Page>
  <View style={{alignItems:'center',gap:10,marginTop:24}}>
   <Logo width={190}/>
   <Text style={[styles.eyebrow,{marginTop:6}]}>PUNTO DE VENTA</Text>
   <Text style={[styles.muted,{textAlign:'center'}]}>Ventas, caja y clientes de tu negocio, desde el celular.</Text>
  </View>
  <Card style={{width:'100%',maxWidth:440,alignSelf:'center',gap:14}}>
   <Text accessibilityRole="header" style={styles.h2}>Inicia sesión</Text>
   <Field label="Usuario" value={username} onChange={setUsername} placeholder="Tu usuario" kind="plain" onSubmit={submit}/>
   <Field label="Contraseña" value={password} onChange={setPassword} secure={!show} placeholder="Tu contraseña" onSubmit={submit}
    right={<Pressable accessibilityRole="button" accessibilityLabel={show?'Ocultar contraseña':'Mostrar contraseña'} hitSlop={10} onPress={()=>setShow(!show)}><Feather name={show?'eye-off':'eye'} size={19} color={colors.muted}/></Pressable>}/>
   <Button title="Entrar" icon="log-in" size="lg" loading={busy} disabled={!ready} onPress={submit}/>
  </Card>
  <View style={{alignItems:'center',gap:4}}>
   <Text style={[styles.small,{textAlign:'center'}]}>¿No tienes usuario? Pídelo al administrador del negocio.</Text>
   <Text style={[styles.small,{fontSize:11,textAlign:'center'}]}>Servidor: {API_URL}</Text>
  </View>
 </Page>;
}
